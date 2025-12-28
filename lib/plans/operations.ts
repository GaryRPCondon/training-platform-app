/**
 * Plan Operations for Structured Modifications
 *
 * This module provides a structured, deterministic approach to plan modifications.
 * Instead of having the LLM regenerate complete weeks (brittle, ~20k tokens),
 * the LLM outputs discrete operations (~200 tokens) that code applies reliably.
 *
 * Benefits:
 * - Original data preserved automatically (no field drift like easy_run → easy)
 * - Much smaller token usage
 * - Deterministic execution
 * - Reusable for drag-and-drop calendar edits
 *
 * Usage:
 * - Chat: LLM parses user intent → operations → preview → apply
 * - Calendar: UI action → single operation → apply
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { FullPlanContext } from '@/lib/chat/plan-context-loader'

// ============================================================================
// Operation Types
// ============================================================================

/**
 * Schedule change operations - move workouts between days
 */
export type ScheduleOperation =
  | {
      op: 'swap_days'
      weekNumbers: number[] | 'all'
      dayA: number
      dayB: number
    }
  | {
      op: 'move_workout_type'
      workoutType: string
      toDay: number
      weekNumbers: number[] | 'all'
    }
  | {
      op: 'reschedule_workout'
      workoutIndex?: string  // e.g., "W14:D6" - resolved to ID
      workoutId?: number     // Direct ID (optional if index provided)
      newDate: string
    }

/**
 * Workout modification operations - change individual workout properties
 * Note: workoutIndex (e.g., "W14:D6") will be resolved to workoutId before execution
 */
export type WorkoutModification =
  | {
      op: 'change_workout_type'
      workoutIndex?: string  // e.g., "W14:D6" - resolved to ID
      workoutId?: number     // Direct ID (optional if index provided)
      newType: string
      newDescription?: string
    }
  | {
      op: 'change_workout_distance'
      workoutIndex?: string
      workoutId?: number
      newDistanceMeters: number
    }
  | {
      op: 'scale_workout_distance'
      workoutIndex?: string
      workoutId?: number
      factor: number
    }
  | {
      op: 'change_intensity'
      workoutIndex?: string
      workoutId?: number
      newIntensity: string
    }

/**
 * Bulk operations - affect multiple workouts
 */
export type BulkOperation =
  | {
      op: 'remove_workout_type'
      workoutType: string
      replacement: string
      weekNumbers: number[] | 'all'
    }
  | {
      op: 'scale_week_volume'
      weekNumber: number
      factor: number
    }
  | {
      op: 'scale_phase_volume'
      phaseName: string
      factor: number
    }

/**
 * All operation types
 */
export type PlanOperation = ScheduleOperation | WorkoutModification | BulkOperation

/**
 * LLM response that requests fallback to full regeneration
 */
export interface FallbackRequest {
  fallback: true
  reason: string
}

/**
 * Result of operation validation
 */
export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * Preview of a single operation
 */
export interface OperationPreview {
  operation: PlanOperation
  description: string
  affectedWorkouts: Array<{
    workoutId: number
    weekNumber: number
    day: number
    before: {
      date: string
      type: string
      description: string
      distanceKm: number | null
    }
    after: {
      date: string
      type: string
      description: string
      distanceKm: number | null
    }
  }>
}

/**
 * Result of applying operations
 */
export interface ApplyResult {
  success: boolean
  operationsApplied: number
  workoutsModified: number
  errors: string[]
}

// ============================================================================
// Human-Readable Descriptions
// ============================================================================

/**
 * Convert day number (1-7 relative to week start) to day name
 *
 * @param dayNumber - Day number within week (1 = first day, 7 = last day)
 * @param weekStartsOn - Day of week that week starts on (0=Sunday, 1=Monday, etc.)
 * @returns Day name (e.g., "Monday", "Friday")
 */
function getDayName(dayNumber: number, weekStartsOn: number): string {
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

  // Convert plan day number (1-7 relative to week start) to calendar day (0-6)
  // dayNumber 1 = weekStartsOn
  // dayNumber 2 = weekStartsOn + 1, etc.
  const calendarDay = (weekStartsOn + dayNumber - 1) % 7
  return dayNames[calendarDay]
}

/**
 * Generate human-readable description of an operation
 *
 * @param op - Operation to describe
 * @param weekStartsOn - Day of week that week starts on (0=Sunday, 1=Monday, etc.) - defaults to 0 (Sunday)
 */
export function describeOperation(op: PlanOperation, weekStartsOn: number = 0): string {
  switch (op.op) {
    case 'swap_days': {
      const weekDesc = op.weekNumbers === 'all' ? 'all weeks' : `weeks ${(op.weekNumbers as number[]).join(', ')}`
      const dayAName = getDayName(op.dayA, weekStartsOn)
      const dayBName = getDayName(op.dayB, weekStartsOn)
      return `Swap ${dayAName} and ${dayBName} in ${weekDesc}`
    }
    case 'move_workout_type': {
      const weekDesc = op.weekNumbers === 'all' ? 'all weeks' : `weeks ${(op.weekNumbers as number[]).join(', ')}`
      const dayName = getDayName(op.toDay, weekStartsOn)
      return `Move ${op.workoutType} workouts to ${dayName} in ${weekDesc}`
    }
    case 'reschedule_workout':
      return `Move workout ${op.workoutIndex || `#${op.workoutId}`} to ${op.newDate}`
    case 'change_workout_type':
      return `Change workout ${op.workoutIndex || `#${op.workoutId}`} to ${op.newType}`
    case 'change_workout_distance':
      return `Change workout ${op.workoutIndex || `#${op.workoutId}`} distance to ${(op.newDistanceMeters / 1000).toFixed(1)}km`
    case 'scale_workout_distance':
      return `Scale workout ${op.workoutIndex || `#${op.workoutId}`} distance by ${(op.factor * 100).toFixed(0)}%`
    case 'change_intensity':
      return `Change workout ${op.workoutIndex || `#${op.workoutId}`} intensity to ${op.newIntensity}`
    case 'remove_workout_type': {
      const weekDesc = op.weekNumbers === 'all' ? 'all weeks' : `weeks ${(op.weekNumbers as number[]).join(', ')}`
      return `Replace ${op.workoutType} with ${op.replacement} in ${weekDesc}`
    }
    case 'scale_week_volume':
      return `Scale week ${op.weekNumber} volume by ${(op.factor * 100).toFixed(0)}%`
    case 'scale_phase_volume':
      return `Scale ${op.phaseName} phase volume by ${(op.factor * 100).toFixed(0)}%`
    default:
      return `Unknown operation`
  }
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate operations before applying
 *
 * Checks:
 * - Week numbers exist in plan
 * - Workout IDs exist (for direct references)
 * - Day numbers are valid (1-7)
 * - Workout types are valid
 * - No consecutive hard workouts after applying
 */
export function validateOperations(
  operations: PlanOperation[],
  planContext: FullPlanContext
): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  const validWorkoutTypes = [
    'rest', 'recovery', 'easy', 'easy_run', 'long_run',
    'progression', 'tempo', 'intervals', 'speed', 'race', 'cross_training'
  ]

  const hardWorkoutTypes = ['tempo', 'intervals', 'speed', 'race', 'long_run']

  for (const op of operations) {
    switch (op.op) {
      case 'swap_days':
        if (op.dayA < 1 || op.dayA > 7) {
          errors.push(`swap_days: Invalid day ${op.dayA}`)
        }
        if (op.dayB < 1 || op.dayB > 7) {
          errors.push(`swap_days: Invalid day ${op.dayB}`)
        }
        if (op.weekNumbers !== 'all') {
          for (const wn of op.weekNumbers) {
            if (!planContext.weeks.find(w => w.week_number === wn)) {
              errors.push(`swap_days: Week ${wn} not found`)
            }
          }
        }
        break

      case 'move_workout_type':
        if (op.toDay < 1 || op.toDay > 7) {
          errors.push(`move_workout_type: Invalid target day ${op.toDay}`)
        }
        if (!validWorkoutTypes.includes(op.workoutType)) {
          warnings.push(`move_workout_type: Unknown workout type "${op.workoutType}"`)
        }
        break

      case 'reschedule_workout':
        // We'd need to query the database to validate workoutId
        // For now, just validate date format
        if (!/^\d{4}-\d{2}-\d{2}$/.test(op.newDate)) {
          errors.push(`reschedule_workout: Invalid date format "${op.newDate}"`)
        }
        break

      case 'change_workout_type':
        if (!validWorkoutTypes.includes(op.newType)) {
          warnings.push(`change_workout_type: Unknown workout type "${op.newType}"`)
        }
        break

      case 'change_workout_distance':
        if (op.newDistanceMeters < 0) {
          errors.push(`change_workout_distance: Distance cannot be negative`)
        }
        if (op.newDistanceMeters > 100000) {
          warnings.push(`change_workout_distance: Distance over 100km seems high`)
        }
        break

      case 'scale_workout_distance':
      case 'scale_week_volume':
      case 'scale_phase_volume':
        const factor = op.factor
        if (factor <= 0) {
          errors.push(`${op.op}: Factor must be positive`)
        }
        if (factor > 2) {
          warnings.push(`${op.op}: Scaling by more than 2x may be excessive`)
        }
        if (factor < 0.5) {
          warnings.push(`${op.op}: Scaling to less than 50% may be excessive`)
        }
        break

      case 'remove_workout_type':
        if (!validWorkoutTypes.includes(op.replacement)) {
          warnings.push(`remove_workout_type: Unknown replacement type "${op.replacement}"`)
        }
        break
    }
  }

  // TODO: Check for consecutive hard workouts after simulating operations

  return {
    valid: errors.length === 0,
    errors,
    warnings
  }
}

// ============================================================================
// Preview Generation
// ============================================================================

/**
 * Generate preview of operations showing before/after state
 *
 * This allows users to review changes before applying.
 *
 * For multiple operations on the same workout, this merges them into a single
 * before/after preview showing the cumulative effect.
 */
export function previewOperations(
  operations: PlanOperation[],
  planContext: FullPlanContext
): OperationPreview[] {
  const previews: OperationPreview[] = []

  for (const op of operations) {
    const preview: OperationPreview = {
      operation: op,
      description: describeOperation(op),
      affectedWorkouts: []
    }

    switch (op.op) {
      case 'swap_days': {
        const targetWeeks = op.weekNumbers === 'all'
          ? planContext.weeks
          : planContext.weeks.filter(w => (op.weekNumbers as number[]).includes(w.week_number))

        for (const week of targetWeeks) {
          const workoutA = week.workouts.find(w => w.day === op.dayA)
          const workoutB = week.workouts.find(w => w.day === op.dayB)

          if (workoutA) {
            // Calculate new date for workoutA (going to dayB)
            const newDateA = calculateNewDate(week.week_start_date, op.dayB)
            preview.affectedWorkouts.push({
              workoutId: 0, // We don't have IDs in context, would need DB lookup
              weekNumber: week.week_number,
              day: op.dayA,
              before: {
                date: workoutA.scheduled_date,
                type: workoutA.workout_type,
                description: workoutA.description,
                distanceKm: workoutA.distance_km
              },
              after: {
                date: newDateA,
                type: workoutA.workout_type,
                description: workoutA.description,
                distanceKm: workoutA.distance_km
              }
            })
          }

          if (workoutB) {
            const newDateB = calculateNewDate(week.week_start_date, op.dayA)
            preview.affectedWorkouts.push({
              workoutId: 0,
              weekNumber: week.week_number,
              day: op.dayB,
              before: {
                date: workoutB.scheduled_date,
                type: workoutB.workout_type,
                description: workoutB.description,
                distanceKm: workoutB.distance_km
              },
              after: {
                date: newDateB,
                type: workoutB.workout_type,
                description: workoutB.description,
                distanceKm: workoutB.distance_km
              }
            })
          }
        }
        break
      }

      case 'move_workout_type': {
        const targetWeeks = op.weekNumbers === 'all'
          ? planContext.weeks
          : planContext.weeks.filter(w => (op.weekNumbers as number[]).includes(w.week_number))

        for (const week of targetWeeks) {
          const matchingWorkout = week.workouts.find(w => w.workout_type === op.workoutType)
          const targetDayWorkout = week.workouts.find(w => w.day === op.toDay)

          if (matchingWorkout && matchingWorkout.day !== op.toDay) {
            // Add the workout being moved
            const newDate = calculateNewDate(week.week_start_date, op.toDay)
            preview.affectedWorkouts.push({
              workoutId: 0,
              weekNumber: week.week_number,
              day: matchingWorkout.day,
              before: {
                date: matchingWorkout.scheduled_date,
                type: matchingWorkout.workout_type,
                description: matchingWorkout.description,
                distanceKm: matchingWorkout.distance_km
              },
              after: {
                date: newDate,
                type: matchingWorkout.workout_type,
                description: matchingWorkout.description,
                distanceKm: matchingWorkout.distance_km
              }
            })

            // Add the workout being swapped (on target day)
            if (targetDayWorkout) {
              const swapDate = calculateNewDate(week.week_start_date, matchingWorkout.day)
              preview.affectedWorkouts.push({
                workoutId: 0,
                weekNumber: week.week_number,
                day: targetDayWorkout.day,
                before: {
                  date: targetDayWorkout.scheduled_date,
                  type: targetDayWorkout.workout_type,
                  description: targetDayWorkout.description,
                  distanceKm: targetDayWorkout.distance_km
                },
                after: {
                  date: swapDate,
                  type: targetDayWorkout.workout_type,
                  description: targetDayWorkout.description,
                  distanceKm: targetDayWorkout.distance_km
                }
              })
            }
          }
        }
        break
      }

      case 'scale_week_volume': {
        const week = planContext.weeks.find(w => w.week_number === op.weekNumber)
        if (week) {
          for (const workout of week.workouts) {
            if (workout.distance_km && workout.workout_type !== 'rest') {
              const newDistance = workout.distance_km * op.factor
              preview.affectedWorkouts.push({
                workoutId: 0,
                weekNumber: week.week_number,
                day: workout.day,
                before: {
                  date: workout.scheduled_date,
                  type: workout.workout_type,
                  description: workout.description,
                  distanceKm: workout.distance_km
                },
                after: {
                  date: workout.scheduled_date,
                  type: workout.workout_type,
                  description: workout.description,
                  distanceKm: parseFloat(newDistance.toFixed(1))
                }
              })
            }
          }
        }
        break
      }

      case 'remove_workout_type': {
        const targetWeeks = op.weekNumbers === 'all'
          ? planContext.weeks
          : planContext.weeks.filter(w => (op.weekNumbers as number[]).includes(w.week_number))

        for (const week of targetWeeks) {
          for (const workout of week.workouts) {
            if (workout.workout_type === op.workoutType) {
              preview.affectedWorkouts.push({
                workoutId: 0,
                weekNumber: week.week_number,
                day: workout.day,
                before: {
                  date: workout.scheduled_date,
                  type: workout.workout_type,
                  description: workout.description,
                  distanceKm: workout.distance_km
                },
                after: {
                  date: workout.scheduled_date,
                  type: op.replacement,
                  description: workout.description,
                  distanceKm: workout.distance_km
                }
              })
            }
          }
        }
        break
      }

      case 'change_workout_type':
      case 'change_workout_distance':
      case 'scale_workout_distance':
      case 'reschedule_workout': {
        // Find workout by index using helper
        const workoutIndex = (op as any).workoutIndex
        if (!workoutIndex) break

        // Parse the index to get week and day numbers
        const parsed = parseWorkoutIndex(workoutIndex)
        if (!parsed) break

        const found = findWorkoutByIndex(workoutIndex, planContext)

        // Handle existing workout
        if (found) {
          const { week, workout } = found

          // Build before state
          const before = {
            date: workout.scheduled_date,
            type: workout.workout_type,
            description: workout.description,
            distanceKm: workout.distance_km
          }

          // Build after state based on operation type
          const after = { ...before }

          if (op.op === 'change_workout_type') {
            const newType = (op as any).newType
            after.type = newType

            // Use shared helper to get smart defaults for preview
            const defaults = getWorkoutTypeDefaults(newType, workout.distance_km)
            if (defaults.description) after.description = defaults.description
            if (defaults.distance_target_meters !== undefined) {
              after.distanceKm = defaults.distance_target_meters / 1000
            }
          } else if (op.op === 'change_workout_distance') {
            after.distanceKm = (op as any).newDistanceMeters / 1000
          } else if (op.op === 'scale_workout_distance') {
            after.distanceKm = (workout.distance_km || 0) * (op as any).factor
          } else if (op.op === 'reschedule_workout') {
            after.date = (op as any).newDate
          }

          preview.affectedWorkouts.push({
            workoutId: 0,
            weekNumber: week.week_number,
            day: workout.day,
            before,
            after
          })
        } else {
          // Handle empty slot - workout will be created
          const week = planContext.weeks.find(w => w.week_number === parsed.weekNumber)
          if (!week) break

          const scheduledDate = calculateNewDate(week.week_start_date, parsed.dayNumber)

          // Build before state (empty slot)
          const before = {
            date: scheduledDate,
            type: 'rest',
            description: 'Empty',
            distanceKm: null as number | null
          }

          // Build after state based on operation type
          const after = {
            date: scheduledDate,
            type: 'rest',
            description: 'Rest day',
            distanceKm: null as number | null
          }

          if (op.op === 'change_workout_type') {
            after.type = (op as any).newType
            after.description = (op as any).newDescription || `${(op as any).newType} workout`
          } else if (op.op === 'change_workout_distance') {
            after.distanceKm = (op as any).newDistanceMeters / 1000
          } else if (op.op === 'reschedule_workout') {
            after.date = (op as any).newDate
          }

          preview.affectedWorkouts.push({
            workoutId: 0,
            weekNumber: week.week_number,
            day: parsed.dayNumber,
            before,
            after
          })
        }
        break
      }

      // Add more operation previews as needed
    }

    previews.push(preview)
  }

  // Post-process: Merge multiple operations on the same workout
  // This ensures previews show cumulative effects (e.g., rest → race + distance change)
  return mergeWorkoutPreviews(previews)
}

/**
 * Merge previews for operations targeting the same workout
 *
 * When multiple operations target the same workout (e.g., change type + change distance),
 * this merges them into a single before/after preview showing the cumulative effect.
 *
 * @param previews - Array of operation previews
 * @returns Previews with merged affected workouts
 */
function mergeWorkoutPreviews(previews: OperationPreview[]): OperationPreview[] {
  // Collect all affected workouts across all operations
  const workoutMap = new Map<string, {
    workoutId: number
    weekNumber: number
    day: number
    before: {
      date: string
      type: string
      description: string
      distanceKm: number | null
    }
    after: {
      date: string
      type: string
      description: string
      distanceKm: number | null
    }
    operations: PlanOperation[]
  }>()

  // First pass: collect all changes by workout
  for (const preview of previews) {
    for (const affected of preview.affectedWorkouts) {
      const key = `W${affected.weekNumber}:D${affected.day}`

      const existing = workoutMap.get(key)
      if (!existing) {
        // First operation on this workout
        workoutMap.set(key, {
          ...affected,
          operations: [preview.operation]
        })
      } else {
        // Subsequent operation on same workout - merge the changes
        // Keep the original 'before' state, update 'after' state with new changes
        const merged = { ...existing }

        // Apply changes to the 'after' state
        if (affected.after.date !== existing.after.date) {
          merged.after.date = affected.after.date
        }
        if (affected.after.type !== existing.before.type) {
          merged.after.type = affected.after.type
        }
        if (affected.after.description !== existing.before.description) {
          merged.after.description = affected.after.description
        }
        if (affected.after.distanceKm !== null && affected.after.distanceKm !== existing.before.distanceKm) {
          merged.after.distanceKm = affected.after.distanceKm
        }

        merged.operations.push(preview.operation)
        workoutMap.set(key, merged)
      }
    }
  }

  // Second pass: rebuild previews with merged workouts
  const mergedPreviews: OperationPreview[] = []

  for (const preview of previews) {
    // Skip if this operation's workouts have already been included in a merged preview
    const affectedWorkouts = preview.affectedWorkouts
      .map(w => {
        const key = `W${w.weekNumber}:D${w.day}`
        return workoutMap.get(key)
      })
      .filter((w): w is NonNullable<typeof w> => {
        if (!w) return false
        // Include if this is the first operation for this workout
        return w.operations[0] === preview.operation
      })

    if (affectedWorkouts.length > 0) {
      mergedPreviews.push({
        operation: preview.operation,
        description: preview.description,
        affectedWorkouts: affectedWorkouts.map(w => ({
          workoutId: w.workoutId,
          weekNumber: w.weekNumber,
          day: w.day,
          before: w.before,
          after: w.after
        }))
      })
    }
  }

  return mergedPreviews
}

// ============================================================================
// Operation Execution
// ============================================================================

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
    // This ensures that even if workouts move, we still have their IDs
    // Also auto-creates workouts for empty slots when targeted by operations
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
    // Distance/intensity changes should happen before type changes so auto-generated
    // descriptions (like "10.0 mile race") use the updated distance
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
// Shared Helper: Smart Defaults for Workout Types
// ============================================================================

/**
 * Generate smart defaults for a workout type change
 * Returns the fields that should be updated based on the new type
 *
 * @param newType - The new workout type
 * @param currentDistanceKm - Current distance in kilometers (for race description)
 * @returns Object with fields to update (description, distance_target_meters, etc.)
 */
function getWorkoutTypeDefaults(
  newType: string,
  currentDistanceKm?: number | null
): {
  description?: string
  intensity_target?: string
  distance_target_meters?: number
  duration_target_seconds?: number | null
} {
  const updates: any = {}

  switch (newType) {
    case 'race': {
      const distanceMiles = currentDistanceKm
        ? (currentDistanceKm / 1.60934).toFixed(1)
        : ''
      updates.description = distanceMiles ? `${distanceMiles} mile race` : 'Race'
      updates.intensity_target = 'hard'
      break
    }
    case 'long_run':
      updates.description = 'Long run'
      updates.intensity_target = 'moderate'
      break
    case 'tempo':
      updates.description = 'Tempo run'
      updates.intensity_target = 'hard'
      break
    case 'intervals':
    case 'speed':
      updates.description = 'Interval training'
      updates.intensity_target = 'hard'
      break
    case 'easy_run':
    case 'easy':
      updates.description = 'Easy run'
      updates.intensity_target = 'easy'
      break
    case 'rest':
      updates.description = 'Rest day'
      updates.intensity_target = 'easy'
      updates.distance_target_meters = 0
      updates.duration_target_seconds = null
      break
    case 'recovery':
      updates.description = 'Recovery'
      updates.intensity_target = 'easy'
      // Keep distance for recovery workouts
      break
    case 'progression':
      updates.description = 'Progression run'
      updates.intensity_target = 'moderate'
      break
    case 'cross_training':
      updates.description = 'Cross training'
      updates.intensity_target = 'easy'
      break
    default:
      updates.description = newType
      break
  }

  return updates
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
    // Get workout IDs for both days
    const workoutsForWeek = await getWorkoutsForWeek(planId, week.week_number, supabase)
    const workoutA = workoutsForWeek.find(w => w.day === op.dayA)
    const workoutB = workoutsForWeek.find(w => w.day === op.dayB)

    if (workoutA && workoutB) {
      // Swap the scheduled dates and day indices
      const dateA = workoutA.scheduled_date
      const dateB = workoutB.scheduled_date

      // Update workoutA to dateB
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

      // Update workoutB to dateA
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

    // Find the workout to move
    const workoutToMove = workoutsForWeek.find(w => w.workout_type === op.workoutType)
    if (!workoutToMove || workoutToMove.day === op.toDay) continue

    // Find the workout currently on the target day
    const workoutOnTargetDay = workoutsForWeek.find(w => w.day === op.toDay)
    if (!workoutOnTargetDay) {
      errors.push(`No workout found on day ${op.toDay} in week ${week.week_number}`)
      continue
    }

    // Swap them
    const dateToMove = workoutToMove.scheduled_date
    const dateTarget = workoutOnTargetDay.scheduled_date
    const dayToMove = workoutToMove.day

    // Update the workout being moved to target day
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

    // Update the workout that was on target day to original day
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
  // Resolve workout index to ID if provided
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
  // Resolve workout index to ID if provided
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

  // Get current workout to access distance for smart description generation
  const { data: workout, error: fetchError } = await supabase
    .from('planned_workouts')
    .select('distance_target_meters')
    .eq('id', workoutId)
    .single()

  if (fetchError) {
    return { success: false, workoutsModified: 0, errors: [fetchError.message] }
  }

  const update: Record<string, any> = { workout_type: op.newType }

  // Auto-generate description and intensity if not explicitly provided
  if (op.newDescription) {
    update.description = op.newDescription
  } else {
    // Use shared helper to get smart defaults
    const distanceKm = workout?.distance_target_meters
      ? workout.distance_target_meters / 1000
      : null
    const defaults = getWorkoutTypeDefaults(op.newType, distanceKm)
    Object.assign(update, defaults)
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
  // Resolve workout index to ID if provided
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
    .update({ distance_target_meters: op.newDistanceMeters })
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
  // Resolve workout index to ID if provided
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

  // Get current distance
  const { data: workout, error: fetchError } = await supabase
    .from('planned_workouts')
    .select('distance_target_meters')
    .eq('id', workoutId)
    .single()

  if (fetchError || !workout) {
    return { success: false, workoutsModified: 0, errors: ['Workout not found'] }
  }

  const newDistance = Math.round((workout.distance_target_meters || 0) * op.factor)

  const { error } = await supabase
    .from('planned_workouts')
    .update({ distance_target_meters: newDistance })
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
  // Resolve workout index to ID if provided
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
    .update({ intensity_target: op.newIntensity })
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

      const { error } = await supabase
        .from('planned_workouts')
        .update({ distance_target_meters: newDistance })
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
        const { error } = await supabase
          .from('planned_workouts')
          .update({ workout_type: op.replacement })
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

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse workout index string into week and day numbers
 *
 * @param workoutIndex - Workout index string like "W14:D6"
 * @returns Object with weekNumber and dayNumber, or null if invalid
 */
function parseWorkoutIndex(workoutIndex: string): { weekNumber: number; dayNumber: number } | null {
  const match = workoutIndex.match(/^W(\d+):D(\d+)$/i)
  if (!match) {
    return null
  }

  return {
    weekNumber: parseInt(match[1], 10),
    dayNumber: parseInt(match[2], 10)
  }
}

/**
 * Find workout in plan context by index
 *
 * @param workoutIndex - Workout index string like "W14:D6"
 * @param planContext - Full plan context
 * @returns Workout and week objects, or null if not found
 */
function findWorkoutByIndex(
  workoutIndex: string,
  planContext: FullPlanContext
): { week: typeof planContext.weeks[0]; workout: typeof planContext.weeks[0]['workouts'][0] } | null {
  const parsed = parseWorkoutIndex(workoutIndex)
  if (!parsed) return null

  const week = planContext.weeks.find(w => w.week_number === parsed.weekNumber)
  if (!week) return null

  const workout = week.workouts.find(w => w.day === parsed.dayNumber)
  if (!workout) return null

  return { week, workout }
}

/**
 * Ensure workout exists at the given index, creating it if necessary
 *
 * @param workoutIndex - Workout index string like "W14:D6"
 * @param planId - Plan ID
 * @param planContext - Full plan context for calculating dates
 * @param supabase - Supabase client
 * @returns Workout ID (existing or newly created), or null if week doesn't exist
 */
async function ensureWorkoutExists(
  workoutIndex: string,
  planId: number,
  planContext: FullPlanContext,
  supabase: SupabaseClient
): Promise<number | null> {
  const parsed = parseWorkoutIndex(workoutIndex)
  if (!parsed) {
    console.warn(`[ensureWorkoutExists] Invalid workout index format: ${workoutIndex}`)
    return null
  }

  const { weekNumber, dayNumber } = parsed

  // First check if workout already exists
  const existingId = await resolveWorkoutIndex(workoutIndex, planId, supabase)
  if (existingId) {
    return existingId
  }

  console.log(`[ensureWorkoutExists] Workout ${workoutIndex} doesn't exist, creating placeholder...`)

  // Find the week in plan context
  const week = planContext.weeks.find(w => w.week_number === weekNumber)
  if (!week) {
    console.warn(`[ensureWorkoutExists] Week ${weekNumber} not found in plan`)
    return null
  }

  // Get the weekly_plan ID for this week
  const { data: weeklyPlan, error: weekError } = await supabase
    .from('weekly_plans')
    .select(`
      id,
      training_phases!inner (
        plan_id
      )
    `)
    .eq('training_phases.plan_id', planId)
    .eq('week_number', weekNumber)
    .maybeSingle()

  if (weekError || !weeklyPlan) {
    console.error(`[ensureWorkoutExists] Failed to find weekly_plan for week ${weekNumber}:`, weekError)
    return null
  }

  // Calculate the scheduled date
  const scheduledDate = calculateNewDate(week.week_start_date, dayNumber)

  // Create placeholder workout (rest type, 0 distance)
  const { data: newWorkout, error: createError } = await supabase
    .from('planned_workouts')
    .insert({
      weekly_plan_id: weeklyPlan.id,
      workout_index: workoutIndex,
      scheduled_date: scheduledDate,
      workout_type: 'rest',
      description: 'Rest day',
      distance_target_meters: 0,
      status: 'scheduled'
    })
    .select('id')
    .single()

  if (createError || !newWorkout) {
    console.error(`[ensureWorkoutExists] Failed to create workout ${workoutIndex}:`, createError)
    return null
  }

  console.log(`[ensureWorkoutExists] Created placeholder workout ${workoutIndex} with ID ${newWorkout.id}`)
  return newWorkout.id
}

/**
 * Resolve workout index (e.g., "W14:D6") to database ID
 *
 * @param workoutIndex - Workout index string like "W14:D6"
 * @param planId - Plan ID to search within
 * @param supabase - Supabase client
 * @returns Workout ID or null if not found
 */
async function resolveWorkoutIndex(
  workoutIndex: string,
  planId: number,
  supabase: SupabaseClient
): Promise<number | null> {
  const parsed = parseWorkoutIndex(workoutIndex)
  if (!parsed) {
    console.warn(`[resolveWorkoutIndex] Invalid workout index format: ${workoutIndex}`)
    return null
  }

  const { weekNumber, dayNumber } = parsed

  // Query for workout with matching week and day
  const { data, error } = await supabase
    .from('planned_workouts')
    .select(`
      id,
      workout_index,
      weekly_plans!inner (
        week_number,
        training_phases!inner (
          plan_id
        )
      )
    `)
    .eq('weekly_plans.training_phases.plan_id', planId)
    .eq('weekly_plans.week_number', weekNumber)
    .eq('workout_index', workoutIndex)
    .maybeSingle()

  if (error) {
    console.error(`[resolveWorkoutIndex] Error resolving ${workoutIndex}:`, error)
    return null
  }

  if (!data) {
    console.warn(`[resolveWorkoutIndex] Workout not found: ${workoutIndex} in plan ${planId}`)
    return null
  }

  return data.id
}

/**
 * Get workouts for a specific week from the database
 */
async function getWorkoutsForWeek(
  planId: number,
  weekNumber: number,
  supabase: SupabaseClient
): Promise<Array<{
  id: number
  day: number
  scheduled_date: string
  workout_type: string
  distance_target_meters: number | null
}>> {
  const { data, error } = await supabase
    .from('planned_workouts')
    .select(`
      id,
      scheduled_date,
      workout_type,
      workout_index,
      distance_target_meters,
      weekly_plans!inner (
        week_number,
        training_phases!inner (
          plan_id
        )
      )
    `)
    .eq('weekly_plans.training_phases.plan_id', planId)
    .eq('weekly_plans.week_number', weekNumber)

  if (error || !data) {
    console.error('Error fetching workouts for week:', error)
    return []
  }

  // Extract day number from workout_index (W#:D#)
  return data.map(workout => {
    const dayMatch = workout.workout_index?.match(/D(\d+)/)
    const day = dayMatch ? parseInt(dayMatch[1], 10) : 0

    return {
      id: workout.id,
      day,
      scheduled_date: workout.scheduled_date,
      workout_type: workout.workout_type,
      distance_target_meters: workout.distance_target_meters
    }
  })
}

/**
 * Calculate new date based on week start and day number
 */
function calculateNewDate(weekStartDate: string, day: number): string {
  const start = new Date(weekStartDate)
  const newDate = new Date(start)
  newDate.setDate(start.getDate() + (day - 1))
  return newDate.toISOString().split('T')[0]
}

/**
 * Check if a response from LLM is a fallback request
 */
export function isFallbackRequest(response: any): response is FallbackRequest {
  return response && response.fallback === true && typeof response.reason === 'string'
}
