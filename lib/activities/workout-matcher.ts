/**
 * Workout Matcher Service
 *
 * Auto-matches activities to planned workouts and manages manual linking/unlinking.
 * Scoring logic is delegated to scoring.ts.
 */

import { format, parseISO } from 'date-fns'
import type { Activity, PlannedWorkout, TrainingPaces } from '@/types/database'
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeActivityType } from '@/lib/constants/workout-colors'
import {
  getEffectiveDistance,
  calculateDistanceDiff,
  calculateDurationDiff,
  scoreWorkoutCompletion,
  loadActivePlanPaces,
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

  const trainingPaces = await loadActivePlanPaces(supabase, athleteId)

  const plan = buildMatchPlan(activities, workouts, trainingPaces)

  const matches: MatchResult[] = []
  for (const match of plan) {
    await linkActivityToWorkout(
      supabase,
      activities.find(a => a.id === match.activityId)!,
      workouts.find(w => w.id === match.workoutId)!,
      match,
    )
    matches.push(match)
  }

  return matches
}

interface Candidate {
  match: MatchResult
  /** Absolute distance diff (%) — tiebreaker so the closest activity wins ties. */
  distanceDiffAbs: number
}

/**
 * Decide which activities link to which workouts.
 *
 * A day can have several activities (e.g. warm-up + parkrun + cooldown) competing
 * for the same planned workout. Assigning greedily per-activity lets whichever
 * activity is processed first claim the workout, even when a later activity is a
 * much better fit. Instead, score every viable activity↔workout pair, then assign
 * globally best-first — each activity and workout used at most once — so the
 * closest match wins the workout.
 *
 * Exported for testing.
 */
export function buildMatchPlan(
  activities: Activity[],
  workouts: PlannedWorkout[],
  trainingPaces: TrainingPaces | null,
): MatchResult[] {
  const candidates: Candidate[] = []

  for (const activity of activities) {
    if (!activity.start_time) continue
    const activityDay = format(parseISO(activity.start_time), 'yyyy-MM-dd')
    const sameDayWorkouts = workouts.filter(w => w.scheduled_date === activityDay)
    if (sameDayWorkouts.length === 0) continue

    // A day with a single planned workout is unambiguous (0.6 bar); a day with
    // several workouts needs a higher bar (0.75) to auto-link with confidence.
    const threshold = sameDayWorkouts.length === 1 ? 0.6 : 0.75
    const method: MatchResult['method'] = sameDayWorkouts.length === 1 ? 'auto_time' : 'auto_distance'

    for (const workout of sameDayWorkouts) {
      const confidence = calculateConfidence(activity, workout, trainingPaces)
      if (confidence <= threshold) continue
      const distanceDiff = activityDistanceDiff(activity, workout, trainingPaces)
      candidates.push({
        distanceDiffAbs: Math.abs(distanceDiff),
        match: {
          activityId: activity.id,
          workoutId: workout.id,
          confidence,
          method,
          metadata: {
            distance_diff_percent: distanceDiff,
            duration_diff_percent: activityDurationDiff(activity, workout),
          },
        },
      })
    }
  }

  // Best confidence first; break ties by the closest distance match.
  candidates.sort((a, b) =>
    b.match.confidence - a.match.confidence || a.distanceDiffAbs - b.distanceDiffAbs
  )

  const usedActivities = new Set<number>()
  const usedWorkouts = new Set<number>()
  const plan: MatchResult[] = []
  for (const { match } of candidates) {
    if (usedActivities.has(match.activityId) || usedWorkouts.has(match.workoutId)) continue
    usedActivities.add(match.activityId)
    usedWorkouts.add(match.workoutId)
    plan.push(match)
  }
  return plan
}

/** Match confidence (0.0 to 1.0) */
function calculateConfidence(activity: Activity, workout: PlannedWorkout, trainingPaces: TrainingPaces | null): number {
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

  const effectiveDistance = getEffectiveDistance(workout, trainingPaces)
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
function activityDistanceDiff(activity: Activity, workout: PlannedWorkout, trainingPaces: TrainingPaces | null): number {
  return calculateDistanceDiff(activity.distance_meters, getEffectiveDistance(workout, trainingPaces))
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
