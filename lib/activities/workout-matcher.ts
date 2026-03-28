/**
 * Workout Matcher Service
 *
 * Auto-matches activities to planned workouts and manages manual linking/unlinking.
 * Scoring logic is delegated to scoring.ts.
 */

import { format, parseISO } from 'date-fns'
import type { Activity, PlannedWorkout } from '@/types/database'
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeActivityType } from '@/lib/constants/workout-colors'
import {
  getEffectiveDistance,
  calculateDistanceDiff,
  calculateDurationDiff,
  scoreWorkoutCompletion,
} from '@/lib/activities/scoring'

export interface MatchResult {
  activityId: number
  workoutId: number
  confidence: number
  method: 'auto_time' | 'auto_distance' | 'manual'
  metadata: {
    time_diff_minutes?: number
    distance_diff_percent?: number
    duration_diff_percent?: number
    manual_link_reason?: string
  }
}

/**
 * Match unlinked activities to pending workouts for date range
 */
export async function matchActivitiesToWorkouts(
  supabase: SupabaseClient,
  athleteId: string,
  startDate: string,
  endDate: string
): Promise<MatchResult[]> {
  const { data: activities } = await supabase
    .from('activities')
    .select('*')
    .eq('athlete_id', athleteId)
    .is('planned_workout_id', null)
    .gte('start_time', startDate)
    .lte('start_time', endDate + 'T23:59:59')

  const { data: workouts } = await supabase
    .from('planned_workouts')
    .select('*')
    .eq('athlete_id', athleteId)
    .is('completed_activity_id', null)
    .gte('scheduled_date', startDate)
    .lte('scheduled_date', endDate)

  if (!activities || !workouts) return []

  const matches: MatchResult[] = []
  const matchedWorkoutIds = new Set<number>()

  for (const activity of activities) {
    const match = findBestWorkoutMatch(activity, workouts.filter(w => !matchedWorkoutIds.has(w.id)))

    if (match) {
      console.log('[AutoMatch] Match candidate:', {
        activityId: match.activityId, workoutId: match.workoutId,
        confidence: match.confidence, method: match.method,
        accepted: match.confidence >= 0.6
      })
    }

    if (match && match.confidence >= 0.6) {
      await linkActivityToWorkout(supabase, activity, workouts.find(w => w.id === match.workoutId)!, match)
      matches.push(match)
      matchedWorkoutIds.add(match.workoutId)
    }
  }

  return matches
}

/**
 * Find best matching workout for an activity
 */
function findBestWorkoutMatch(
  activity: Activity,
  workouts: PlannedWorkout[],
): MatchResult | null {
  if (!activity.start_time) return null

  const activityDate = parseISO(activity.start_time)
  const activityDay = format(activityDate, 'yyyy-MM-dd')

  const sameDayWorkouts = workouts.filter(w => w.scheduled_date === activityDay)

  console.log('[AutoMatch] Day check: activity', activity.id, 'start_time=', activity.start_time,
    'parsed day=', activityDay, 'workout dates=', workouts.map(w => w.scheduled_date),
    'same-day matches=', sameDayWorkouts.length)

  if (sameDayWorkouts.length === 0) return null

  if (sameDayWorkouts.length === 1) {
    const workout = sameDayWorkouts[0]
    const confidence = calculateConfidence(activity, workout)
    console.log('[AutoMatch] Single-day scoring:', {
      activityId: activity.id, workoutId: workout.id,
      activityType: activity.activity_type, workoutType: workout.workout_type,
      normalizedType: normalizeActivityType(activity.activity_type,
        typeof activity.strava_data === 'string' ? JSON.parse(activity.strava_data) : activity.strava_data),
      distance: activity.distance_meters,
      target: workout.distance_target_meters,
      confidence
    })

    if (confidence > 0.6) {
      return {
        activityId: activity.id,
        workoutId: workout.id,
        confidence,
        method: 'auto_time',
        metadata: {
          distance_diff_percent: activityDistanceDiff(activity, workout),
          duration_diff_percent: activityDurationDiff(activity, workout),
        },
      }
    }
  }

  let bestMatch: MatchResult | null = null

  for (const workout of sameDayWorkouts) {
    const confidence = calculateConfidence(activity, workout)

    if (confidence > 0.75 && (!bestMatch || confidence > bestMatch.confidence)) {
      bestMatch = {
        activityId: activity.id,
        workoutId: workout.id,
        confidence,
        method: 'auto_distance',
        metadata: {
          distance_diff_percent: activityDistanceDiff(activity, workout),
          duration_diff_percent: activityDurationDiff(activity, workout),
        },
      }
    }
  }

  return bestMatch
}

/** Match confidence (0.0 to 1.0) */
function calculateConfidence(activity: Activity, workout: PlannedWorkout): number {
  let score = 0.5

  const stravaData = typeof activity.strava_data === 'string'
    ? JSON.parse(activity.strava_data) : activity.strava_data
  const normalizedType = normalizeActivityType(activity.activity_type, stravaData)
  if (normalizedType === workout.workout_type) {
    score += 0.3
  } else if (normalizedType !== 'default' && normalizedType !== 'rest') {
    const runTypes = ['easy_run', 'long_run', 'intervals', 'tempo', 'recovery', 'race']
    if (runTypes.includes(normalizedType) && runTypes.includes(workout.workout_type)) {
      score += 0.15
    }
  }

  const effectiveDistance = getEffectiveDistance(workout)
  if (activity.distance_meters && effectiveDistance) {
    const diff = Math.abs(activity.distance_meters - effectiveDistance)
    const percent = diff / effectiveDistance
    if (percent < 0.1) score += 0.2
    else if (percent < 0.2) score += 0.1
  }

  if (activity.duration_seconds && workout.duration_target_seconds) {
    const diff = Math.abs(activity.duration_seconds - workout.duration_target_seconds)
    const percent = diff / workout.duration_target_seconds
    if (percent < 0.15) score += 0.1
  }

  return Math.min(1.0, score)
}

/** Distance diff for match metadata (Activity → PlannedWorkout wrapper) */
function activityDistanceDiff(activity: Activity, workout: PlannedWorkout): number {
  return calculateDistanceDiff(activity.distance_meters, getEffectiveDistance(workout))
}

/** Duration diff for match metadata */
function activityDurationDiff(activity: Activity, workout: PlannedWorkout): number {
  return calculateDurationDiff(activity.duration_seconds, workout.duration_target_seconds)
}

/**
 * Link activity to workout (bidirectional update)
 */
async function linkActivityToWorkout(
  supabase: SupabaseClient,
  activity: Activity,
  workout: PlannedWorkout,
  match: MatchResult,
): Promise<void> {
  const result = await scoreWorkoutCompletion(supabase, activity, workout)

  const { error: activityError } = await supabase
    .from('activities')
    .update({
      planned_workout_id: workout.id,
      match_confidence: match.confidence,
      match_method: match.method,
      match_metadata: match.metadata,
    })
    .eq('id', activity.id)

  if (activityError) {
    console.error('Failed to update activity:', activityError)
    throw new Error(`Failed to link activity: ${activityError.message}`)
  }

  const { error: workoutError } = await supabase
    .from('planned_workouts')
    .update({
      completed_activity_id: activity.id,
      completion_status: result.completionStatus,
      completion_metadata: result.completionMetadata,
    })
    .eq('id', workout.id)

  if (workoutError) {
    console.error('Failed to update workout:', workoutError)
    throw new Error(`Failed to link workout: ${workoutError.message}`)
  }
}

/**
 * Manually link activity to workout
 */
export async function manuallyLinkWorkout(
  supabase: SupabaseClient,
  activityId: number,
  workoutId: number,
  athleteId: string,
  reason?: string
): Promise<void> {
  const { data: activity } = await supabase
    .from('activities')
    .select('*')
    .eq('id', activityId)
    .eq('athlete_id', athleteId)
    .single()

  const { data: workout } = await supabase
    .from('planned_workouts')
    .select('*')
    .eq('id', workoutId)
    .eq('athlete_id', athleteId)
    .single()

  if (!activity || !workout) throw new Error('Activity or workout not found')

  await linkActivityToWorkout(supabase, activity, workout, {
    activityId,
    workoutId,
    confidence: 1.0,
    method: 'manual',
    metadata: { manual_link_reason: reason },
  })
}

/**
 * Unlink activity from workout (bidirectional clear)
 */
export async function unlinkWorkout(supabase: SupabaseClient, activityId: number, athleteId: string): Promise<void> {
  const { data: activity } = await supabase
    .from('activities')
    .select('planned_workout_id')
    .eq('id', activityId)
    .eq('athlete_id', athleteId)
    .single()

  if (!activity?.planned_workout_id) return

  const { error: workoutError } = await supabase
    .from('planned_workouts')
    .update({
      completed_activity_id: null,
      completion_status: 'pending',
      completion_metadata: null,
    })
    .eq('id', activity.planned_workout_id)

  if (workoutError) {
    console.error('Failed to reset workout:', workoutError)
    throw new Error(`Failed to unlink workout: ${workoutError.message}`)
  }

  const { error: activityError } = await supabase
    .from('activities')
    .update({
      planned_workout_id: null,
      match_confidence: null,
      match_method: null,
      match_metadata: null,
    })
    .eq('id', activityId)

  if (activityError) {
    console.error('Failed to reset activity:', activityError)
    throw new Error(`Failed to unlink activity: ${activityError.message}`)
  }
}

// Re-export for convenience
export { rescoreCompletion } from '@/lib/activities/rescore-completion'
