/**
 * Operation execution — applies operations to the database
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { FullPlanContext } from '@/lib/chat/plan-context-loader'
import {
  scaleStructuredWorkoutDistance,
  rebuildStructuredWorkoutForType,
  updateStructuredWorkoutIntensity,
} from '@/lib/plans/structured-workout-builder'
import type { PlanOperation, ApplyResult } from './types'
import { validateOperations } from './validate'
import {
  resolveWorkoutIndex,
  ensureWorkoutExists,
  getWorkoutsForWeek,
  getWorkoutTypeDefaults,
  calculateNewDate,
} from './helpers'

/**
 * Apply operations to a plan in the database
 *
 * This is the core function that modifies the plan based on operations.
 * Each operation is applied atomically.
 */
export async function applyOperations(
  planId: number,
  operations: PlanOperation[],
  planContext: FullPlanContext,
  supabase: SupabaseClient
): Promise<ApplyResult> {
  const errors: string[] = []
  let operationsApplied = 0
  let workoutsModified = 0

  try {
    // Validate before applying
    const validation = validateOperations(operations, planContext)
    if (!validation.valid) {
      return {
        success: false,
        operationsApplied: 0,
        workoutsModified: 0,
        errors: validation.errors
      }
    }

    // Get plan start date for calculations
    const { data: plan, error: planError } = await supabase
      .from('training_plans')
      .select('id, start_date')
      .eq('id', planId)
      .single()

    if (planError || !plan) {
      return {
        success: false,
        operationsApplied: 0,
        workoutsModified: 0,
        errors: ['Plan not found']
      }
    }

    // Pre-resolve ALL workout indices to IDs before applying operations
    const resolvedOperations = await Promise.all(
      operations.map(async (op) => {
        const opCopy = { ...op } as any
        if ('workoutIndex' in opCopy && opCopy.workoutIndex && !opCopy.workoutId) {
          const resolvedId = await ensureWorkoutExists(opCopy.workoutIndex, planId, planContext, supabase)
          if (resolvedId) {
            opCopy.workoutId = resolvedId
          }
        }
        return opCopy
      })
    )

    // Sort operations to ensure dependencies are applied in correct order
    const sortedOperations = [...resolvedOperations].sort((a, b) => {
      const priorityOrder: Record<string, number> = {
        'change_workout_distance': 1,
        'scale_workout_distance': 1,
        'change_intensity': 2,
        'change_workout_type': 3,
        'reschedule_workout': 4,
        'swap_days': 5,
        'move_workout_type': 5,
        'remove_workout_type': 6,
        'scale_week_volume': 7,
        'scale_phase_volume': 8
      }
      const aPriority = priorityOrder[a.op] || 99
      const bPriority = priorityOrder[b.op] || 99
      return aPriority - bPriority
    })

    // Apply each operation
    for (const op of sortedOperations) {
      const result = await applySingleOperation(op, planId, planContext, supabase)
      if (result.success) {
        operationsApplied++
        workoutsModified += result.workoutsModified
      } else {
        errors.push(...result.errors)
      }
    }

    return {
      success: errors.length === 0,
      operationsApplied,
      workoutsModified,
      errors
    }
  } catch (error) {
    return {
      success: false,
      operationsApplied,
      workoutsModified,
      errors: [error instanceof Error ? error.message : 'Unknown error']
    }
  }
}

/**
 * Apply a single operation
 */
async function applySingleOperation(
  op: PlanOperation,
  planId: number,
  planContext: FullPlanContext,
  supabase: SupabaseClient
): Promise<{ success: boolean; workoutsModified: number; errors: string[] }> {
  const errors: string[] = []
  let workoutsModified = 0

  try {
    switch (op.op) {
      case 'swap_days': {
        const result = await executeSwapDays(op, planId, planContext, supabase)
        workoutsModified = result.workoutsModified
        if (!result.success) errors.push(...result.errors)
        break
      }

      case 'move_workout_type': {
        const result = await executeMoveWorkoutType(op, planId, planContext, supabase)
        workoutsModified = result.workoutsModified
        if (!result.success) errors.push(...result.errors)
        break
      }

      case 'reschedule_workout': {
        const result = await executeRescheduleWorkout(op, planId, supabase)
        workoutsModified = result.workoutsModified
        if (!result.success) errors.push(...result.errors)
        break
      }

      case 'change_workout_type': {
        const result = await executeChangeWorkoutType(op, planId, supabase)
        workoutsModified = result.workoutsModified
        if (!result.success) errors.push(...result.errors)
        break
      }

      case 'change_workout_distance': {
        const result = await executeChangeDistance(op, planId, supabase)
        workoutsModified = result.workoutsModified
        if (!result.success) errors.push(...result.errors)
        break
      }

      case 'scale_workout_distance': {
        const result = await executeScaleDistance(op, planId, supabase)
        workoutsModified = result.workoutsModified
        if (!result.success) errors.push(...result.errors)
        break
      }

      case 'change_intensity': {
        const result = await executeChangeIntensity(op, planId, supabase)
        workoutsModified = result.workoutsModified
        if (!result.success) errors.push(...result.errors)
        break
      }

      case 'scale_week_volume': {
        const result = await executeScaleWeekVolume(op, planId, planContext, supabase)
        workoutsModified = result.workoutsModified
        if (!result.success) errors.push(...result.errors)
        break
      }

      case 'remove_workout_type': {
        const result = await executeRemoveWorkoutType(op, planId, planContext, supabase)
        workoutsModified = result.workoutsModified
        if (!result.success) errors.push(...result.errors)
        break
      }

      default:
        errors.push(`Unsupported operation: ${(op as any).op}`)
    }

    return {
      success: errors.length === 0,
      workoutsModified,
      errors
    }
  } catch (error) {
    return {
      success: false,
      workoutsModified: 0,
      errors: [error instanceof Error ? error.message : 'Unknown error']
    }
  }
}

// ============================================================================
// Operation Executors
// ============================================================================

async function executeSwapDays(
  op: { op: 'swap_days'; weekNumbers: number[] | 'all'; dayA: number; dayB: number },
  planId: number,
  planContext: FullPlanContext,
  supabase: SupabaseClient
): Promise<{ success: boolean; workoutsModified: number; errors: string[] }> {
  const errors: string[] = []
  let workoutsModified = 0

  const targetWeeks = op.weekNumbers === 'all'
    ? planContext.weeks
    : planContext.weeks.filter(w => (op.weekNumbers as number[]).includes(w.week_number))

  for (const week of targetWeeks) {
    const workoutsForWeek = await getWorkoutsForWeek(planId, week.week_number, supabase)
    const workoutA = workoutsForWeek.find(w => w.day === op.dayA)
    const workoutB = workoutsForWeek.find(w => w.day === op.dayB)

    if (workoutA && workoutB) {
      const dateA = workoutA.scheduled_date
      const dateB = workoutB.scheduled_date

      const { error: errorA } = await supabase
        .from('planned_workouts')
        .update({
          scheduled_date: dateB,
          workout_index: `W${week.week_number}:D${op.dayB}`
        })
        .eq('id', workoutA.id)

      if (errorA) {
        errors.push(`Failed to update workout ${workoutA.id}: ${errorA.message}`)
        continue
      }

      const { error: errorB } = await supabase
        .from('planned_workouts')
        .update({
          scheduled_date: dateA,
          workout_index: `W${week.week_number}:D${op.dayA}`
        })
        .eq('id', workoutB.id)

      if (errorB) {
        errors.push(`Failed to update workout ${workoutB.id}: ${errorB.message}`)
        continue
      }

      workoutsModified += 2
    }
  }

  return { success: errors.length === 0, workoutsModified, errors }
}

async function executeMoveWorkoutType(
  op: { op: 'move_workout_type'; workoutType: string; toDay: number; weekNumbers: number[] | 'all' },
  planId: number,
  planContext: FullPlanContext,
  supabase: SupabaseClient
): Promise<{ success: boolean; workoutsModified: number; errors: string[] }> {
  const errors: string[] = []
  let workoutsModified = 0

  const targetWeeks = op.weekNumbers === 'all'
    ? planContext.weeks
    : planContext.weeks.filter(w => (op.weekNumbers as number[]).includes(w.week_number))

  for (const week of targetWeeks) {
    const workoutsForWeek = await getWorkoutsForWeek(planId, week.week_number, supabase)

    const workoutToMove = workoutsForWeek.find(w => w.workout_type === op.workoutType)
    if (!workoutToMove || workoutToMove.day === op.toDay) continue

    const workoutOnTargetDay = workoutsForWeek.find(w => w.day === op.toDay)
    if (!workoutOnTargetDay) {
      errors.push(`No workout found on day ${op.toDay} in week ${week.week_number}`)
      continue
    }

    const dateToMove = workoutToMove.scheduled_date
    const dateTarget = workoutOnTargetDay.scheduled_date
    const dayToMove = workoutToMove.day

    const { error: error1 } = await supabase
      .from('planned_workouts')
      .update({
        scheduled_date: dateTarget,
        workout_index: `W${week.week_number}:D${op.toDay}`
      })
      .eq('id', workoutToMove.id)

    if (error1) {
      errors.push(`Failed to move workout: ${error1.message}`)
      continue
    }

    const { error: error2 } = await supabase
      .from('planned_workouts')
      .update({
        scheduled_date: dateToMove,
        workout_index: `W${week.week_number}:D${dayToMove}`
      })
      .eq('id', workoutOnTargetDay.id)

    if (error2) {
      errors.push(`Failed to swap workout: ${error2.message}`)
      continue
    }

    workoutsModified += 2
  }

  return { success: errors.length === 0, workoutsModified, errors }
}

async function executeRescheduleWorkout(
  op: { op: 'reschedule_workout'; workoutIndex?: string; workoutId?: number; newDate: string },
  planId: number,
  supabase: SupabaseClient
): Promise<{ success: boolean; workoutsModified: number; errors: string[] }> {
  let workoutId = op.workoutId
  if (!workoutId && op.workoutIndex) {
    const resolvedId = await resolveWorkoutIndex(op.workoutIndex, planId, supabase)
    if (!resolvedId) {
      return {
        success: false,
        workoutsModified: 0,
        errors: [`Workout not found: ${op.workoutIndex}`]
      }
    }
    workoutId = resolvedId
  }

  if (!workoutId) {
    return {
      success: false,
      workoutsModified: 0,
      errors: ['No workoutId or workoutIndex provided']
    }
  }

  const { error } = await supabase
    .from('planned_workouts')
    .update({ scheduled_date: op.newDate })
    .eq('id', workoutId)

  if (error) {
    return { success: false, workoutsModified: 0, errors: [error.message] }
  }

  return { success: true, workoutsModified: 1, errors: [] }
}

async function executeChangeWorkoutType(
  op: { op: 'change_workout_type'; workoutIndex?: string; workoutId?: number; newType: string; newDescription?: string },
  planId: number,
  supabase: SupabaseClient
): Promise<{ success: boolean; workoutsModified: number; errors: string[] }> {
  let workoutId = op.workoutId
  if (!workoutId && op.workoutIndex) {
    const resolvedId = await resolveWorkoutIndex(op.workoutIndex, planId, supabase)
    if (!resolvedId) {
      return {
        success: false,
        workoutsModified: 0,
        errors: [`Workout not found: ${op.workoutIndex}`]
      }
    }
    workoutId = resolvedId
  }

  if (!workoutId) {
    return {
      success: false,
      workoutsModified: 0,
      errors: ['No workoutId or workoutIndex provided']
    }
  }

  const { data: workout, error: fetchError } = await supabase
    .from('planned_workouts')
    .select('distance_target_meters, intensity_target, garmin_workout_id, garmin_sync_status')
    .eq('id', workoutId)
    .single()

  if (fetchError) {
    return { success: false, workoutsModified: 0, errors: [fetchError.message] }
  }

  const update: Record<string, any> = { workout_type: op.newType }

  if (op.newDescription) {
    update.description = op.newDescription
  } else {
    const distanceKm = workout?.distance_target_meters
      ? workout.distance_target_meters / 1000
      : null
    const defaults = getWorkoutTypeDefaults(op.newType, distanceKm)
    Object.assign(update, defaults)
  }

  const intensity = update.intensity_target ?? workout?.intensity_target ?? 'moderate'
  update.structured_workout = rebuildStructuredWorkoutForType(
    op.newType,
    workout?.distance_target_meters ?? null,
    intensity
  )

  if (workout?.garmin_workout_id && workout.garmin_sync_status === 'synced') {
    update.garmin_sync_status = 'stale'
  }

  const { error } = await supabase
    .from('planned_workouts')
    .update(update)
    .eq('id', workoutId)

  if (error) {
    return { success: false, workoutsModified: 0, errors: [error.message] }
  }

  return { success: true, workoutsModified: 1, errors: [] }
}

async function executeChangeDistance(
  op: { op: 'change_workout_distance'; workoutIndex?: string; workoutId?: number; newDistanceMeters: number },
  planId: number,
  supabase: SupabaseClient
): Promise<{ success: boolean; workoutsModified: number; errors: string[] }> {
  let workoutId = op.workoutId
  if (!workoutId && op.workoutIndex) {
    const resolvedId = await resolveWorkoutIndex(op.workoutIndex, planId, supabase)
    if (!resolvedId) {
      return {
        success: false,
        workoutsModified: 0,
        errors: [`Workout not found: ${op.workoutIndex}`]
      }
    }
    workoutId = resolvedId
  }

  if (!workoutId) {
    return {
      success: false,
      workoutsModified: 0,
      errors: ['No workoutId or workoutIndex provided']
    }
  }

  const { data: workout, error: fetchError } = await supabase
    .from('planned_workouts')
    .select('distance_target_meters, structured_workout, garmin_workout_id, garmin_sync_status')
    .eq('id', workoutId)
    .single()

  if (fetchError || !workout) {
    return { success: false, workoutsModified: 0, errors: [fetchError?.message ?? 'Workout not found'] }
  }

  const update: Record<string, any> = { distance_target_meters: op.newDistanceMeters }

  const sw = workout.structured_workout as Record<string, unknown> | null
  if (sw?.main_set !== undefined && workout.distance_target_meters && workout.distance_target_meters > 0) {
    const factor = op.newDistanceMeters / workout.distance_target_meters
    update.structured_workout = scaleStructuredWorkoutDistance(sw, factor)
  }

  if (workout.garmin_workout_id && workout.garmin_sync_status === 'synced') {
    update.garmin_sync_status = 'stale'
  }

  const { error } = await supabase
    .from('planned_workouts')
    .update(update)
    .eq('id', workoutId)

  if (error) {
    return { success: false, workoutsModified: 0, errors: [error.message] }
  }

  return { success: true, workoutsModified: 1, errors: [] }
}

async function executeScaleDistance(
  op: { op: 'scale_workout_distance'; workoutIndex?: string; workoutId?: number; factor: number },
  planId: number,
  supabase: SupabaseClient
): Promise<{ success: boolean; workoutsModified: number; errors: string[] }> {
  let workoutId = op.workoutId
  if (!workoutId && op.workoutIndex) {
    const resolvedId = await resolveWorkoutIndex(op.workoutIndex, planId, supabase)
    if (!resolvedId) {
      return {
        success: false,
        workoutsModified: 0,
        errors: [`Workout not found: ${op.workoutIndex}`]
      }
    }
    workoutId = resolvedId
  }

  if (!workoutId) {
    return {
      success: false,
      workoutsModified: 0,
      errors: ['No workoutId or workoutIndex provided']
    }
  }

  const { data: workout, error: fetchError } = await supabase
    .from('planned_workouts')
    .select('distance_target_meters, structured_workout, garmin_workout_id, garmin_sync_status')
    .eq('id', workoutId)
    .single()

  if (fetchError || !workout) {
    return { success: false, workoutsModified: 0, errors: ['Workout not found'] }
  }

  const newDistance = Math.round((workout.distance_target_meters || 0) * op.factor)
  const update: Record<string, any> = { distance_target_meters: newDistance }

  const sw = workout.structured_workout as Record<string, unknown> | null
  if (sw?.main_set !== undefined) {
    update.structured_workout = scaleStructuredWorkoutDistance(sw, op.factor)
  }

  if (workout.garmin_workout_id && workout.garmin_sync_status === 'synced') {
    update.garmin_sync_status = 'stale'
  }

  const { error } = await supabase
    .from('planned_workouts')
    .update(update)
    .eq('id', workoutId)

  if (error) {
    return { success: false, workoutsModified: 0, errors: [error.message] }
  }

  return { success: true, workoutsModified: 1, errors: [] }
}

async function executeChangeIntensity(
  op: { op: 'change_intensity'; workoutIndex?: string; workoutId?: number; newIntensity: string },
  planId: number,
  supabase: SupabaseClient
): Promise<{ success: boolean; workoutsModified: number; errors: string[] }> {
  let workoutId = op.workoutId
  if (!workoutId && op.workoutIndex) {
    const resolvedId = await resolveWorkoutIndex(op.workoutIndex, planId, supabase)
    if (!resolvedId) {
      return {
        success: false,
        workoutsModified: 0,
        errors: [`Workout not found: ${op.workoutIndex}`]
      }
    }
    workoutId = resolvedId
  }

  if (!workoutId) {
    return {
      success: false,
      workoutsModified: 0,
      errors: ['No workoutId or workoutIndex provided']
    }
  }

  const { data: workout, error: fetchError } = await supabase
    .from('planned_workouts')
    .select('structured_workout, garmin_workout_id, garmin_sync_status')
    .eq('id', workoutId)
    .single()

  if (fetchError || !workout) {
    return { success: false, workoutsModified: 0, errors: [fetchError?.message ?? 'Workout not found'] }
  }

  const update: Record<string, any> = { intensity_target: op.newIntensity }

  const sw = workout.structured_workout as Record<string, unknown> | null
  if (sw?.main_set !== undefined) {
    update.structured_workout = updateStructuredWorkoutIntensity(sw, op.newIntensity)
  }

  if (workout.garmin_workout_id && workout.garmin_sync_status === 'synced') {
    update.garmin_sync_status = 'stale'
  }

  const { error } = await supabase
    .from('planned_workouts')
    .update(update)
    .eq('id', workoutId)

  if (error) {
    return { success: false, workoutsModified: 0, errors: [error.message] }
  }

  return { success: true, workoutsModified: 1, errors: [] }
}

async function executeScaleWeekVolume(
  op: { op: 'scale_week_volume'; weekNumber: number; factor: number },
  planId: number,
  planContext: FullPlanContext,
  supabase: SupabaseClient
): Promise<{ success: boolean; workoutsModified: number; errors: string[] }> {
  const errors: string[] = []
  let workoutsModified = 0

  const workoutsForWeek = await getWorkoutsForWeek(planId, op.weekNumber, supabase)

  for (const workout of workoutsForWeek) {
    if (workout.distance_target_meters && workout.workout_type !== 'rest') {
      const newDistance = Math.round(workout.distance_target_meters * op.factor)
      const update: Record<string, any> = { distance_target_meters: newDistance }

      const sw = workout.structured_workout as Record<string, unknown> | null
      if (sw?.main_set !== undefined) {
        update.structured_workout = scaleStructuredWorkoutDistance(sw, op.factor)
      }

      if (workout.garmin_workout_id && workout.garmin_sync_status === 'synced') {
        update.garmin_sync_status = 'stale'
      }

      const { error } = await supabase
        .from('planned_workouts')
        .update(update)
        .eq('id', workout.id)

      if (error) {
        errors.push(`Failed to scale workout ${workout.id}: ${error.message}`)
      } else {
        workoutsModified++
      }
    }
  }

  // Also update weekly_volume_target
  const week = planContext.weeks.find(w => w.week_number === op.weekNumber)
  if (week) {
    const { data: weeklyPlan } = await supabase
      .from('weekly_plans')
      .select('id, weekly_volume_target')
      .eq('week_number', op.weekNumber)
      .single()

    if (weeklyPlan) {
      const newVolume = Math.round((weeklyPlan.weekly_volume_target || 0) * op.factor)
      await supabase
        .from('weekly_plans')
        .update({ weekly_volume_target: newVolume })
        .eq('id', weeklyPlan.id)
    }
  }

  return { success: errors.length === 0, workoutsModified, errors }
}

async function executeRemoveWorkoutType(
  op: { op: 'remove_workout_type'; workoutType: string; replacement: string; weekNumbers: number[] | 'all' },
  planId: number,
  planContext: FullPlanContext,
  supabase: SupabaseClient
): Promise<{ success: boolean; workoutsModified: number; errors: string[] }> {
  const errors: string[] = []
  let workoutsModified = 0

  const targetWeeks = op.weekNumbers === 'all'
    ? planContext.weeks
    : planContext.weeks.filter(w => (op.weekNumbers as number[]).includes(w.week_number))

  for (const week of targetWeeks) {
    const workoutsForWeek = await getWorkoutsForWeek(planId, week.week_number, supabase)

    for (const workout of workoutsForWeek) {
      if (workout.workout_type === op.workoutType) {
        const update: Record<string, any> = {
          workout_type: op.replacement,
          structured_workout: rebuildStructuredWorkoutForType(
            op.replacement,
            workout.distance_target_meters,
            'moderate'
          ),
        }

        if (workout.garmin_workout_id && workout.garmin_sync_status === 'synced') {
          update.garmin_sync_status = 'stale'
        }

        const { error } = await supabase
          .from('planned_workouts')
          .update(update)
          .eq('id', workout.id)

        if (error) {
          errors.push(`Failed to replace workout ${workout.id}: ${error.message}`)
        } else {
          workoutsModified++
        }
      }
    }
  }

  return { success: errors.length === 0, workoutsModified, errors }
}
