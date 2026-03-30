/**
 * Shared helpers for plan operations
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { FullPlanContext } from '@/lib/chat/plan-context-loader'

/**
 * Convert day number (1-7 relative to week start) to day name
 */
export function getDayName(dayNumber: number, weekStartsOn: number): string {
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const calendarDay = (weekStartsOn + dayNumber - 1) % 7
  return dayNames[calendarDay]
}

/**
 * Parse workout index string into week and day numbers
 *
 * @param workoutIndex - Workout index string like "W14:D6"
 * @returns Object with weekNumber and dayNumber, or null if invalid
 */
export function parseWorkoutIndex(workoutIndex: string): { weekNumber: number; dayNumber: number } | null {
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
 */
export function findWorkoutByIndex(
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
 * Calculate new date based on week start and day number
 */
export function calculateNewDate(weekStartDate: string, day: number): string {
  const start = new Date(weekStartDate)
  const newDate = new Date(start)
  newDate.setDate(start.getDate() + (day - 1))
  return newDate.toISOString().split('T')[0]
}

/**
 * Generate smart defaults for a workout type change
 */
export function getWorkoutTypeDefaults(
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

/**
 * Resolve workout index (e.g., "W14:D6") to database ID
 */
export async function resolveWorkoutIndex(
  workoutIndex: string,
  planId: number,
  supabase: SupabaseClient
): Promise<number | null> {
  const parsed = parseWorkoutIndex(workoutIndex)
  if (!parsed) {
    console.warn(`[resolveWorkoutIndex] Invalid workout index format: ${workoutIndex}`)
    return null
  }

  const { weekNumber } = parsed

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
 * Ensure workout exists at the given index, creating it if necessary
 */
export async function ensureWorkoutExists(
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
 * Get workouts for a specific week from the database
 */
export async function getWorkoutsForWeek(
  planId: number,
  weekNumber: number,
  supabase: SupabaseClient
): Promise<Array<{
  id: number
  day: number
  scheduled_date: string
  workout_type: string
  distance_target_meters: number | null
  structured_workout: Record<string, unknown> | null
  garmin_workout_id: string | null
  garmin_sync_status: string | null
}>> {
  const { data, error } = await supabase
    .from('planned_workouts')
    .select(`
      id,
      scheduled_date,
      workout_type,
      workout_index,
      distance_target_meters,
      structured_workout,
      garmin_workout_id,
      garmin_sync_status,
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

  return data.map(workout => {
    const dayMatch = workout.workout_index?.match(/D(\d+)/)
    const day = dayMatch ? parseInt(dayMatch[1], 10) : 0

    return {
      id: workout.id,
      day,
      scheduled_date: workout.scheduled_date,
      workout_type: workout.workout_type,
      distance_target_meters: workout.distance_target_meters,
      structured_workout: workout.structured_workout as Record<string, unknown> | null,
      garmin_workout_id: workout.garmin_workout_id as string | null,
      garmin_sync_status: workout.garmin_sync_status as string | null,
    }
  })
}
