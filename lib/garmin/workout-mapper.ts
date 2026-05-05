/**
 * Garmin Workout JSON Mapper
 *
 * Converts the app's structured_workout JSONB format into the Garmin Connect
 * workout JSON format for sending to the Garmin API.
 *
 * Pace format: Garmin uses m/s for pace targets.
 *   targetValueOne = slower end (lower m/s)
 *   targetValueTwo = faster end (higher m/s)
 *   Conversion: m/s = 1000 / secondsPerKm
 *
 * References:
 *   - garmin_planner: https://github.com/yeekang-0311/garmin_planner
 *   - garmin-workouts: https://github.com/mkuthan/garmin-workouts
 */

import type { PlannedWorkout, TrainingPaces } from '@/types/database'
import type {
  GarminWorkoutPayload,
  GarminWorkoutStep,
  GarminSportType,
  GarminEndCondition,
  GarminTargetType,
} from './types'
import { getWorkoutPaceType, type AllTrainingPaces } from '@/lib/training/vdot'
import { resolvePace, type PaceTarget } from '@/lib/plans/pace-resolver'

// ============================================================================
// Constants
// ============================================================================

const RUNNING_SPORT_TYPE: GarminSportType = {
  sportTypeId: 1,
  sportTypeKey: 'running',
}

// Step type IDs confirmed from garmin_planner/constant.py
const STEP_TYPES = {
  warmup:   { stepTypeId: 1, stepTypeKey: 'warmup' },
  cooldown: { stepTypeId: 2, stepTypeKey: 'cooldown' },
  interval: { stepTypeId: 3, stepTypeKey: 'interval' },
  recovery: { stepTypeId: 4, stepTypeKey: 'recovery' },
  rest:     { stepTypeId: 5, stepTypeKey: 'rest' },
  repeat:   { stepTypeId: 6, stepTypeKey: 'repeat' },
} as const

const END_CONDITIONS = {
  lapButton: { conditionTypeId: 1, conditionTypeKey: 'lap.button' },
  time:      { conditionTypeId: 2, conditionTypeKey: 'time' },
  distance:  { conditionTypeId: 3, conditionTypeKey: 'distance' },
  iterations:{ conditionTypeId: 7, conditionTypeKey: 'iterations' },
} as const

const TARGET_TYPES = {
  noTarget:  { workoutTargetTypeId: 1, workoutTargetTypeKey: 'no.target' },
  paceZone:  { workoutTargetTypeId: 6, workoutTargetTypeKey: 'pace.zone' },
} as const

// ±15 sec/km tolerance band for pace targets
const PACE_TOLERANCE_SEC_PER_KM = 15

// ============================================================================
// Pace conversion utilities
// ============================================================================

/**
 * Convert seconds-per-km (our internal format) to meters-per-second (Garmin format)
 */
function secPerKmToMps(secPerKm: number): number {
  return 1000 / secPerKm
}

/**
 * Parse a pace string like "3:45/km" or "3:45" into seconds per km
 */
function parsePaceString(pace: string): number | null {
  const match = pace.match(/^(\d+):(\d{2})/)
  if (!match) return null
  const minutes = parseInt(match[1], 10)
  const seconds = parseInt(match[2], 10)
  return minutes * 60 + seconds
}

/**
 * Build Garmin pace target (targetValueOne/Two in m/s) from a center pace in sec/km.
 * targetValueOne = slow end, targetValueTwo = fast end (Garmin convention).
 */
function buildPaceTarget(centerSecPerKm: number): { targetValueOne: number; targetValueTwo: number } {
  const slowSecPerKm = centerSecPerKm + PACE_TOLERANCE_SEC_PER_KM
  const fastSecPerKm = centerSecPerKm - PACE_TOLERANCE_SEC_PER_KM

  return {
    targetValueOne: parseFloat(secPerKmToMps(slowSecPerKm).toFixed(4)),
    targetValueTwo: parseFloat(secPerKmToMps(fastSecPerKm).toFixed(4)),
  }
}

/**
 * Resolve a pace target from an intensity label and/or training paces.
 * Returns null if no pace can be determined.
 *
 * Resolution order:
 *   1. Template's `pace_targets` (authoritative, methodology-aware) — handles
 *      every template's label conventions: Daniels single-letter (E/T/I/R),
 *      Hansons (strength/speed), Pfitz (vo2max/lactate_threshold), Magness
 *      (LT/MP/5k_pace), Hal Higdon (intervals_400), bespoke (T_time/R10), etc.
 *   2. Built-in substring matcher — fallback for legacy templates with no
 *      pace_targets, recognises longform labels like "easy"/"tempo".
 *   3. Workout-type default — last resort.
 */
function resolvePaceFromIntensity(
  intensity: string | undefined,
  workoutType: string,
  trainingPaces: TrainingPaces | null | undefined,
  paceTargets?: Record<string, PaceTarget>
): { targetValueOne: number; targetValueTwo: number } | null {
  if (!trainingPaces) return null

  // 1. Template-driven lookup — exact label match against template's pace_targets.
  // The training_paces JSONB blob includes race paces too (see plan generate route)
  // so AllTrainingPaces is the right shape here.
  if (intensity && paceTargets) {
    const resolved = resolvePace(intensity, paceTargets, trainingPaces as AllTrainingPaces)
    if (resolved) {
      // resolvePace returns sec/km; if it has an upper bound, that's the slower
      // bound of a range, otherwise we apply the same ±15 sec/km tolerance.
      if (resolved.target_pace_upper_sec_per_km != null) {
        return {
          targetValueOne: parseFloat(secPerKmToMps(resolved.target_pace_upper_sec_per_km).toFixed(4)),
          targetValueTwo: parseFloat(secPerKmToMps(resolved.target_pace_sec_per_km).toFixed(4)),
        }
      }
      return buildPaceTarget(resolved.target_pace_sec_per_km)
    }
  }

  // Map intensity label to a pace type, falling back to workout type
  let paceType: keyof TrainingPaces

  if (intensity) {
    const lower = intensity.toLowerCase()
    if (lower.includes('walk') || lower === 'race') {
      // Walk and race-day get no pace target — race is run on effort, not pace,
      // and a stamped pace would otherwise default to marathon (wrong for 5K/10K).
      return null
    } else if (lower.includes('easy') || lower.includes('recovery')) {
      paceType = 'easy'
    } else if (lower.includes('marathon')) {
      paceType = 'marathon'
    } else if (lower.includes('tempo') || lower.includes('threshold')) {
      paceType = 'tempo'
    } else if (lower.includes('moderate')) {
      paceType = 'marathon'
    } else if (lower.includes('interval') || lower.includes('hard')) {
      paceType = 'interval'
    } else if (lower.includes('repetition') || lower.includes('speed')) {
      paceType = 'repetition'
    } else {
      paceType = getWorkoutPaceType(workoutType)
    }
  } else {
    paceType = getWorkoutPaceType(workoutType)
  }

  const paceSecPerKm = trainingPaces[paceType]
  if (!paceSecPerKm) return null

  return buildPaceTarget(paceSecPerKm)
}

// ============================================================================
// Step builders
// ============================================================================

function buildExecutableStep(
  part: { duration_minutes?: number; duration_seconds?: number; distance_meters?: number; intensity?: string },
  stepOrder: number,
  childStepId: number | null,
  stepType: keyof typeof STEP_TYPES,
  workoutType: string,
  trainingPaces: TrainingPaces | null | undefined,
  intensityOverride?: string,
  targetPaceOverride?: string,
  paceTargets?: Record<string, PaceTarget>
): GarminWorkoutStep {
  // Determine end condition
  let endCondition: GarminEndCondition = END_CONDITIONS.lapButton
  let endConditionValue: number | null = null

  if (part.distance_meters) {
    endCondition = END_CONDITIONS.distance
    endConditionValue = part.distance_meters
  } else if (part.duration_minutes) {
    endCondition = END_CONDITIONS.time
    endConditionValue = part.duration_minutes * 60
  } else if (part.duration_seconds) {
    endCondition = END_CONDITIONS.time
    endConditionValue = part.duration_seconds
  }

  // Determine pace target
  let targetType: GarminTargetType = TARGET_TYPES.noTarget
  let targetValueOne: number | null = null
  let targetValueTwo: number | null = null

  // Explicit pace string takes priority
  if (targetPaceOverride) {
    // Handle "M:SS-M:SS" range format (explicit faster-slower bounds)
    const dashIdx = targetPaceOverride.indexOf('-', 1)
    if (dashIdx > 0) {
      const fasterSec = parsePaceString(targetPaceOverride.slice(0, dashIdx))
      const slowerSec = parsePaceString(targetPaceOverride.slice(dashIdx + 1))
      if (fasterSec && slowerSec) {
        targetType = TARGET_TYPES.paceZone
        targetValueOne = parseFloat(secPerKmToMps(slowerSec).toFixed(4))  // slow end = lower m/s
        targetValueTwo = parseFloat(secPerKmToMps(fasterSec).toFixed(4)) // fast end = higher m/s
      }
    } else {
      const paceSecPerKm = parsePaceString(targetPaceOverride)
      if (paceSecPerKm) {
        const target = buildPaceTarget(paceSecPerKm)
        targetType = TARGET_TYPES.paceZone
        targetValueOne = target.targetValueOne
        targetValueTwo = target.targetValueTwo
      }
    }
  } else {
    const intensityLabel = intensityOverride ?? part.intensity
    const target = resolvePaceFromIntensity(intensityLabel, workoutType, trainingPaces, paceTargets)
    if (target) {
      targetType = TARGET_TYPES.paceZone
      targetValueOne = target.targetValueOne
      targetValueTwo = target.targetValueTwo
    }
  }

  return {
    type: 'ExecutableStepDTO',
    stepId: null,
    stepOrder,
    childStepId,
    description: null,
    stepType: STEP_TYPES[stepType],
    endCondition,
    endConditionValue,
    endConditionCompare: null,
    endConditionZone: null,
    targetType,
    targetValueOne,
    targetValueTwo,
    zoneNumber: null,
  }
}

function buildRepeatStep(
  set: { repeat: number; intervals: { distance_meters?: number; duration_minutes?: number; duration_seconds?: number; intensity?: string; target_pace?: string }[] },
  stepOrder: number,
  workoutType: string,
  trainingPaces: TrainingPaces | null | undefined,
  smartRepeat?: boolean,
  stampedPaceStr?: string,
  workoutIntensity?: string,
  paceTargets?: Record<string, PaceTarget>
): GarminWorkoutStep {
  const childSteps: GarminWorkoutStep[] = set.intervals.map((interval, idx) => {
    const isRecovery = interval.intensity?.toLowerCase().includes('recovery') ||
                       interval.intensity?.toLowerCase().includes('rest') ||
                       interval.intensity?.toLowerCase().includes('walk')
    const stepType = isRecovery ? 'recovery' : 'interval'

    // The workout-level stamped pace only applies to intervals that share the
    // workout's primary intensity. A recovery jog at "E" inside a "T" workout
    // must NOT inherit the tempo stamp — let intensity-based resolution kick in
    // (which consults pace_targets first, then the substring matcher).
    const matchesPrimary = interval.intensity != null && workoutIntensity != null &&
      interval.intensity.toLowerCase() === workoutIntensity.toLowerCase()
    const stampFallback = matchesPrimary ? stampedPaceStr : undefined

    return buildExecutableStep(
      interval,
      idx + 1,
      idx + 1,   // childStepId within the repeat group (1-based)
      stepType,
      workoutType,
      trainingPaces,
      interval.intensity,
      interval.target_pace ?? stampFallback,
      paceTargets
    )
  })

  return {
    type: 'RepeatGroupDTO',
    stepId: null,
    stepOrder,
    childStepId: 1,
    description: null,
    stepType: STEP_TYPES.repeat,
    endCondition: END_CONDITIONS.iterations,
    endConditionValue: set.repeat,
    endConditionCompare: null,
    endConditionZone: null,
    numberOfIterations: set.repeat,
    smartRepeat: true,
    skipLastRestStep: smartRepeat ?? false,
    targetType: TARGET_TYPES.noTarget,
    targetValueOne: null,
    targetValueTwo: null,
    zoneNumber: null,
    workoutSteps: childSteps,
  }
}

// ============================================================================
// Main mapper
// ============================================================================

/**
 * Map a planned_workout row to Garmin Connect workout JSON.
 *
 * Handles two cases:
 *   1. Structured workout (has `structured_workout` JSONB) — warmup/main_set/cooldown
 *   2. Simple workout (no structured_workout) — single distance or time step
 */
export function mapToGarminWorkout(
  workout: Pick<PlannedWorkout,
    'description' | 'workout_type' | 'distance_target_meters' |
    'duration_target_seconds' | 'intensity_target' | 'structured_workout'
  >,
  trainingPaces?: TrainingPaces | null,
  paceTargets?: Record<string, PaceTarget>
): GarminWorkoutPayload {
  const workoutName = workout.description || formatWorkoutTypeName(workout.workout_type)

  // Only use structured steps if there's an actual main_set (not just the old {pace_guidance, notes} shape)
  const sw = workout.structured_workout as (WorkoutStructure & StampedPace) | null
  const hasMainSet = sw?.main_set !== undefined

  // Prefer stamped numeric pace from plan generation or athlete override
  const stampedPaceStr = buildStampedPaceString(sw)
  // For simple workouts, pass through a custom pace override if intensity is 'custom'
  const customPace = stampedPaceStr ?? (!hasMainSet && workout.intensity_target === 'custom' ? sw?.target_pace : undefined)
  const steps = hasMainSet
    ? buildStructuredSteps(workout, trainingPaces, stampedPaceStr, paceTargets)
    : buildSimpleSteps(workout, trainingPaces, customPace, paceTargets)

  return {
    workoutName,
    description: workout.description ?? undefined,
    sportType: RUNNING_SPORT_TYPE,
    workoutSegments: [
      {
        segmentOrder: 1,
        sportType: RUNNING_SPORT_TYPE,
        workoutSteps: steps,
      },
    ],
  }
}

// Structured workout step shape
type StructuredPart = {
  duration_minutes?: number
  duration_seconds?: number
  distance_meters?: number
  intensity?: string
  target_pace?: string
}

type MainSetEntry = {
  repeat?: number
  intervals?: StructuredPart[]
  skip_last_recovery?: boolean
  duration_minutes?: number
  duration_seconds?: number
  distance_meters?: number
  intensity?: string
  target_pace?: string
}

type WorkoutStructure = {
  warmup?: StructuredPart
  cooldown?: StructuredPart
  main_set?: MainSetEntry | MainSetEntry[]
  target_pace?: string   // custom pace override for simple (non-structured) workouts
}

/** Fields stamped by pace-resolver at plan-write or proposal-apply time */
type StampedPace = {
  target_pace_sec_per_km?: number
  target_pace_upper_sec_per_km?: number | null
  pace_source?: string
}

/**
 * Convert stamped numeric pace to a target_pace string that buildExecutableStep can consume.
 * Returns "M:SS" for single pace, "M:SS-M:SS" for range (faster-slower), or undefined.
 */
function buildStampedPaceString(sw: (WorkoutStructure & StampedPace) | null): string | undefined {
  if (!sw || typeof sw.target_pace_sec_per_km !== 'number') return undefined
  const fmtP = (s: number) => `${Math.floor(s / 60)}:${Math.round(s % 60).toString().padStart(2, '0')}`
  if (typeof sw.target_pace_upper_sec_per_km === 'number') {
    // Range: faster (lower sec/km) - slower (higher sec/km)
    return `${fmtP(sw.target_pace_sec_per_km)}-${fmtP(sw.target_pace_upper_sec_per_km)}`
  }
  return fmtP(sw.target_pace_sec_per_km)
}

function buildStructuredSteps(
  workout: Pick<PlannedWorkout, 'workout_type' | 'structured_workout' | 'intensity_target'>,
  trainingPaces: TrainingPaces | null | undefined,
  stampedPaceStr?: string,
  paceTargets?: Record<string, PaceTarget>
): GarminWorkoutStep[] {
  const structure = workout.structured_workout as WorkoutStructure
  const steps: GarminWorkoutStep[] = []
  let stepOrder = 1
  const workoutIntensity = workout.intensity_target ?? undefined

  // Warmup — always resolved from its own intensity (never the workout's stamped pace)
  if (structure.warmup) {
    steps.push(buildExecutableStep(
      structure.warmup,
      stepOrder++,
      null,
      'warmup',
      workout.workout_type,
      trainingPaces,
      structure.warmup.intensity ?? 'easy',
      structure.warmup.target_pace,
      paceTargets
    ))
  }

  // Main set
  const mainSet = Array.isArray(structure.main_set)
    ? structure.main_set
    : structure.main_set ? [structure.main_set] : []

  for (const set of mainSet) {
    if (set.repeat && Array.isArray(set.intervals)) {
      steps.push(buildRepeatStep(
        set as { repeat: number; intervals: StructuredPart[] },
        stepOrder++,
        workout.workout_type,
        trainingPaces,
        set.skip_last_recovery ?? false,
        stampedPaceStr,
        workoutIntensity,
        paceTargets
      ))
    } else {
      const stepType = set.intensity?.toLowerCase().includes('recovery') ? 'recovery' : 'interval'
      // Same primary-intensity guard as buildRepeatStep: only inherit the
      // workout's stamped pace when this leaf interval shares its intensity.
      const matchesPrimary = set.intensity != null && workoutIntensity != null &&
        set.intensity.toLowerCase() === workoutIntensity.toLowerCase()
      const stampFallback = matchesPrimary ? stampedPaceStr : undefined
      steps.push(buildExecutableStep(
        set,
        stepOrder++,
        null,
        stepType,
        workout.workout_type,
        trainingPaces,
        set.intensity,
        set.target_pace ?? stampFallback,
        paceTargets
      ))
    }
  }

  // Cooldown — always resolved from its own intensity (never the workout's stamped pace)
  if (structure.cooldown) {
    steps.push(buildExecutableStep(
      structure.cooldown,
      stepOrder++,
      null,
      'cooldown',
      workout.workout_type,
      trainingPaces,
      structure.cooldown.intensity ?? 'easy',
      structure.cooldown.target_pace,
      paceTargets
    ))
  }

  // Fallback: if nothing was generated, create a single lap-button step
  if (steps.length === 0) {
    steps.push({
      type: 'ExecutableStepDTO',
      stepId: null,
      stepOrder: 1,
      childStepId: null,
      description: null,
      stepType: STEP_TYPES.interval,
      endCondition: END_CONDITIONS.lapButton,
      endConditionValue: null,
      endConditionCompare: null,
      endConditionZone: null,
      targetType: TARGET_TYPES.noTarget,
      targetValueOne: null,
      targetValueTwo: null,
      zoneNumber: null,
    })
  }

  return steps
}

function buildSimpleSteps(
  workout: Pick<PlannedWorkout, 'workout_type' | 'distance_target_meters' | 'duration_target_seconds' | 'intensity_target'>,
  trainingPaces: TrainingPaces | null | undefined,
  targetPaceOverride?: string,
  paceTargets?: Record<string, PaceTarget>
): GarminWorkoutStep[] {
  // Simple workout: single step with distance or time target.
  // No lap-button warmup/cooldown — those are only meaningful for structured workouts.
  let paceTarget: { targetValueOne: number; targetValueTwo: number } | null = null
  if (targetPaceOverride) {
    const secPerKm = parsePaceString(targetPaceOverride)
    if (secPerKm) paceTarget = buildPaceTarget(secPerKm)
  } else {
    paceTarget = resolvePaceFromIntensity(
      workout.intensity_target ?? undefined,
      workout.workout_type,
      trainingPaces,
      paceTargets
    )
  }

  const endCondition: GarminEndCondition = workout.distance_target_meters
    ? END_CONDITIONS.distance
    : workout.duration_target_seconds
      ? END_CONDITIONS.time
      : END_CONDITIONS.lapButton

  return [{
    type: 'ExecutableStepDTO',
    stepId: null,
    stepOrder: 1,
    childStepId: null,
    description: null,
    stepType: STEP_TYPES.interval,
    endCondition,
    endConditionValue: workout.distance_target_meters ?? workout.duration_target_seconds ?? null,
    endConditionCompare: null,
    endConditionZone: null,
    targetType: paceTarget ? TARGET_TYPES.paceZone : TARGET_TYPES.noTarget,
    targetValueOne: paceTarget?.targetValueOne ?? null,
    targetValueTwo: paceTarget?.targetValueTwo ?? null,
    zoneNumber: null,
  }]
}

function formatWorkoutTypeName(workoutType: string): string {
  return workoutType
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}
