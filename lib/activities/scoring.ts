/**
 * Central scoring module for workout completion and accuracy.
 *
 * Completion (distance-based): Did you do the workout?
 * Accuracy (Garmin compliance): Did you hit the right paces?
 *
 * Thresholds are workout-type-aware: easy/recovery runs are more forgiving
 * than structured workouts (intervals, tempo, race).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { calculateTotalWorkoutDistance } from '@/lib/training/vdot'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CompletionThresholds {
  completedDistancePercent: number
  completedDurationPercent: number
  partialDistancePercent: number
  partialDurationPercent: number
}

export interface AccuracyDisplay {
  show: boolean
  score: number
  label: string
  colorClass: string
  caveat: string | null
}

export interface ComplianceResult {
  score: number
  lapCount: number
  hasData: boolean
  activeLapAvg: number | null
}

export interface ScoringResult {
  completionStatus: 'completed' | 'partial' | 'skipped'
  completionMetadata: {
    actual_distance_meters: number | null
    actual_duration_seconds: number | null
    distance_variance_percent: number
    duration_variance_percent: number
    accuracy_score: number | null
    compliance_lap_count: number | null
    active_lap_avg_score: number | null
  }
}

// ---------------------------------------------------------------------------
// Pure functions — no DB access
// ---------------------------------------------------------------------------

/**
 * Get the effective target distance for a workout, including warmup/cooldown
 * estimated from structured_workout when distance_target_meters only covers
 * the main set (intervals, tempo).
 */
export function getEffectiveDistance(workout: {
  distance_target_meters: number | null
  workout_type: string
  structured_workout?: Record<string, unknown> | unknown | null
}): number | null {
  const total = calculateTotalWorkoutDistance(
    workout.distance_target_meters,
    workout.workout_type,
    workout.structured_workout as Record<string, unknown> | null,
    null
  )
  return total > 0 ? total : workout.distance_target_meters
}

/** Percentage difference: positive = over target, negative = under. */
export function calculateDistanceDiff(
  actualMeters: number | null,
  targetMeters: number | null
): number {
  if (!actualMeters || !targetMeters) return 0
  return ((actualMeters - targetMeters) / targetMeters) * 100
}

/** Percentage difference: positive = over target, negative = under. */
export function calculateDurationDiff(
  actualSeconds: number | null,
  targetSeconds: number | null
): number {
  if (!actualSeconds || !targetSeconds) return 0
  return ((actualSeconds - targetSeconds) / targetSeconds) * 100
}

/**
 * Workout-type-aware completion thresholds.
 * Easy/recovery runs are flexible; structured work is stricter.
 */
export function getCompletionThresholds(workoutType: string): CompletionThresholds {
  switch (workoutType) {
    case 'easy_run':
    case 'recovery':
      return {
        completedDistancePercent: 25,
        completedDurationPercent: 35,
        partialDistancePercent: 50,
        partialDurationPercent: 50,
      }
    case 'long_run':
      return {
        completedDistancePercent: 20,
        completedDurationPercent: 30,
        partialDistancePercent: 45,
        partialDurationPercent: 45,
      }
    case 'intervals':
    case 'tempo':
    case 'race':
    default:
      return {
        completedDistancePercent: 15,
        completedDurationPercent: 25,
        partialDistancePercent: 40,
        partialDurationPercent: 40,
      }
  }
}

/** Determine completion status using workout-type-aware thresholds. */
export function determineCompletionStatus(
  workoutType: string,
  absDistanceDiffPercent: number,
  absDurationDiffPercent: number,
  hasDurationTarget: boolean
): 'completed' | 'partial' | 'skipped' {
  const t = getCompletionThresholds(workoutType)

  if (
    absDistanceDiffPercent < t.completedDistancePercent &&
    (absDurationDiffPercent < t.completedDurationPercent || !hasDurationTarget)
  ) {
    return 'completed'
  }
  if (
    absDistanceDiffPercent < t.partialDistancePercent ||
    absDurationDiffPercent < t.partialDurationPercent
  ) {
    return 'partial'
  }
  return 'skipped'
}

/**
 * Interpret an accuracy score in the context of workout type.
 * Easy/recovery/long runs use relaxed thresholds and a different label
 * because Garmin compliance naturally dips on varied terrain.
 */
export function interpretAccuracyScore(
  accuracyScore: number | null,
  workoutType: string | null
): AccuracyDisplay | null {
  if (accuracyScore === null || accuracyScore === undefined) return null

  const type = (workoutType ?? '').toLowerCase()
  const isEasyType = ['easy_run', 'recovery', 'long_run'].includes(type)

  if (isEasyType) {
    return {
      show: true,
      score: accuracyScore,
      label: 'Pace Compliance',
      colorClass:
        accuracyScore >= 50
          ? 'text-emerald-500'
          : accuracyScore >= 30
            ? 'text-amber-500'
            : 'text-red-500',
      caveat: 'Pace compliance is approximate for easy/recovery runs',
    }
  }

  return {
    show: true,
    score: accuracyScore,
    label: 'Workout Accuracy',
    colorClass:
      accuracyScore >= 70
        ? 'text-emerald-500'
        : accuracyScore >= 45
          ? 'text-amber-500'
          : 'text-red-500',
    caveat: null,
  }
}

/**
 * Per-lap compliance color class, workout-type-aware.
 * Returns Tailwind background + text classes, or null if no score.
 */
export function getComplianceColorClass(
  score: number | null,
  workoutType?: string | null
): string | null {
  if (score === null || score === undefined) return null

  const type = (workoutType ?? '').toLowerCase()
  const isEasyType = ['easy_run', 'recovery', 'long_run'].includes(type)

  if (isEasyType) {
    if (score >= 60) return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
    if (score >= 40) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
    return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
  }

  if (score >= 90) return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
  if (score >= 70) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
  return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
}

// ---------------------------------------------------------------------------
// Async functions — DB access
// ---------------------------------------------------------------------------

/**
 * Calculate weighted compliance score from Garmin lap data.
 * ACTIVE/INTERVAL laps weighted at 1.0, WARMUP/COOLDOWN/RECOVERY at 0.3.
 */
export async function calculateComplianceScore(
  supabase: SupabaseClient,
  activityId: number
): Promise<ComplianceResult> {
  const { data: laps } = await supabase
    .from('laps')
    .select('intensity_type, compliance_score')
    .eq('activity_id', activityId)
    .not('compliance_score', 'is', null)

  if (!laps || laps.length === 0) {
    return { score: 0, lapCount: 0, hasData: false, activeLapAvg: null }
  }

  let weightedSum = 0
  let totalWeight = 0
  let activeSum = 0
  let activeCount = 0

  for (const lap of laps) {
    const score = lap.compliance_score as number
    const type = (lap.intensity_type || '').toUpperCase()

    let weight: number
    if (type === 'ACTIVE' || type === 'INTERVAL') {
      weight = 1.0
      activeSum += score
      activeCount++
    } else if (type === 'WARMUP' || type === 'COOLDOWN' || type === 'RECOVERY') {
      weight = 0.3
    } else {
      weight = 0.5
    }

    weightedSum += score * weight
    totalWeight += weight
  }

  const weightedAvg = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0
  const activeLapAvg = activeCount > 0 ? Math.round(activeSum / activeCount) : null

  return { score: weightedAvg, lapCount: laps.length, hasData: true, activeLapAvg }
}

/**
 * Score a workout completion: determines completion status and calculates
 * accuracy from Garmin lap compliance. Returns everything needed to populate
 * the planned_workouts row.
 */
export async function scoreWorkoutCompletion(
  supabase: SupabaseClient,
  activity: { id: number; distance_meters: number | null; duration_seconds: number | null },
  workout: {
    id: number
    workout_type: string
    distance_target_meters: number | null
    duration_target_seconds: number | null
    structured_workout?: Record<string, unknown> | unknown | null
  }
): Promise<ScoringResult> {
  const effectiveDistance = getEffectiveDistance(workout)

  const distanceVariance = calculateDistanceDiff(activity.distance_meters, effectiveDistance)
  const durationVariance = calculateDurationDiff(activity.duration_seconds, workout.duration_target_seconds)

  const completionStatus = determineCompletionStatus(
    workout.workout_type,
    Math.abs(distanceVariance),
    Math.abs(durationVariance),
    !!workout.duration_target_seconds
  )

  const compliance = await calculateComplianceScore(supabase, activity.id)

  return {
    completionStatus,
    completionMetadata: {
      actual_distance_meters: activity.distance_meters,
      actual_duration_seconds: activity.duration_seconds,
      distance_variance_percent: distanceVariance,
      duration_variance_percent: durationVariance,
      accuracy_score: compliance.hasData ? compliance.score : null,
      compliance_lap_count: compliance.hasData ? compliance.lapCount : null,
      active_lap_avg_score: compliance.activeLapAvg,
    },
  }
}
