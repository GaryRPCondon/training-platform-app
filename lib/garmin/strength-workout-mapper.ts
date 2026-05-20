/**
 * Garmin Strength Workout Mapper
 *
 * Converts a StrengthSession (from the app's strength_sessions table) into the
 * Garmin Connect STRENGTH_TRAINING workout JSON.
 *
 * Structure produced for each exercise:
 *   RepeatGroupDTO (numberOfIterations = sets)
 *     └─ ExecutableStepDTO  (the exercise itself: reps / time / distance)
 *     └─ ExecutableStepDTO  (REST step — only if exercise.measurement.rest_seconds is set)
 *   The RepeatGroupDTO uses smartRepeat=true + skipLastRestStep=true so the
 *   final set doesn't include trailing rest (matches the Garmin Connect UI default).
 *
 * Catalog dependency:
 *   Each exercise's `canonical_name` is looked up against the
 *   `strength_exercise_catalog` table to pick up:
 *     - garmin_exercise_category / garmin_exercise_name (Garmin enum strings)
 *     - garmin_step_type ('STRENGTH' | 'CARDIO' | 'OTHER') — drives stepTypeId
 *   Exercises with no matching catalog row are skipped (the API route should
 *   gate on allGarminSupported before calling this mapper, so this is a
 *   belt-and-braces guard).
 *
 * sportTypeId for STRENGTH_TRAINING:
 *   Set to 5 based on the Garmin Connect API conventions used by neighbouring
 *   integrations (garmin_planner, python-garminconnect). This value must be
 *   confirmed against a real STRENGTH_TRAINING workout response — see
 *   docs/garmin_exercise_catalog.md. If incorrect, change here only.
 */

import type {
  StrengthSession,
  StrengthExercise,
  StrengthExerciseCatalog,
} from '@/types/database'
import type {
  GarminWorkoutPayload,
  GarminWorkoutStep,
  GarminSportType,
  GarminEndCondition,
} from './types'

// ============================================================================
// Constants
// ============================================================================

const STRENGTH_SPORT_TYPE: GarminSportType = {
  sportTypeId: 5,
  sportTypeKey: 'strength_training',
}

// Step types for STRENGTH_TRAINING workouts.
// stepTypeId 3 (interval) is the Garmin convention for an active exercise step.
// stepTypeId 5 (rest) is shared with running workouts.
// stepTypeId 6 (repeat) wraps a set group.
const STRENGTH_STEP_TYPES = {
  interval: { stepTypeId: 3, stepTypeKey: 'interval' },
  rest:     { stepTypeId: 5, stepTypeKey: 'rest' },
  repeat:   { stepTypeId: 6, stepTypeKey: 'repeat' },
} as const

// End conditions.
// reps (conditionTypeId 10) is the Garmin convention for rep-counted strength
// steps. time/distance/iterations match the values used by running workouts.
const END_CONDITIONS = {
  lapButton:  { conditionTypeId: 1,  conditionTypeKey: 'lap.button' },
  time:       { conditionTypeId: 2,  conditionTypeKey: 'time' },
  distance:   { conditionTypeId: 3,  conditionTypeKey: 'distance' },
  iterations: { conditionTypeId: 7,  conditionTypeKey: 'iterations' },
  reps:       { conditionTypeId: 10, conditionTypeKey: 'reps' },
} as const

const NO_TARGET = {
  workoutTargetTypeId: 1,
  workoutTargetTypeKey: 'no.target',
} as const

const KG_UNIT = { unitId: 8, unitKey: 'kilogram' } as const

// ============================================================================
// Public API
// ============================================================================

export interface StrengthMapperResult {
  payload: GarminWorkoutPayload
  /**
   * Exercises that were skipped because they had no matching catalog row.
   * The API route should treat any non-empty list as an error.
   */
  skippedExercises: Array<{ canonicalName: string; reason: string }>
}

/**
 * Convert a StrengthSession + catalog to a Garmin STRENGTH_TRAINING payload.
 *
 * @param session    the strength session being exported
 * @param catalog    full strength exercise catalog (keyed lookup is done inside)
 * @returns          payload + any exercises skipped due to missing catalog rows
 */
export function mapStrengthSessionToGarmin(
  session: Pick<StrengthSession, 'title' | 'exercises' | 'coaching_note'>,
  catalog: StrengthExerciseCatalog[],
): StrengthMapperResult {
  const catalogByName = new Map(catalog.map(row => [row.canonical_name, row]))

  const steps: GarminWorkoutStep[] = []
  const skippedExercises: StrengthMapperResult['skippedExercises'] = []
  let stepOrder = 1

  for (const exercise of session.exercises) {
    // Resolution order:
    //   1. Per-exercise stamped enum (added at parse time when the LLM's
    //      suggestion is verbatim-known) — takes priority so one-off
    //      exercises work without a catalog row.
    //   2. Catalog row (curated source of truth for canonical exercises).
    //   3. Skip — recorded in skippedExercises for the route to report.
    const stampedCategory = exercise.garmin_exercise_category
    const stampedName = exercise.garmin_exercise_name
    let resolvedCategory: string | null = null
    let resolvedName: string | null = null
    let resolvedStepType: StrengthExerciseCatalog['garmin_step_type'] = 'STRENGTH'

    if (exercise.garmin_supported && stampedCategory && stampedName) {
      resolvedCategory = stampedCategory
      resolvedName = stampedName
      const catalogRow = catalogByName.get(exercise.canonical_name)
      if (catalogRow) resolvedStepType = catalogRow.garmin_step_type
    } else {
      const catalogRow = catalogByName.get(exercise.canonical_name)
      if (!catalogRow || !catalogRow.garmin_supported) {
        skippedExercises.push({
          canonicalName: exercise.canonical_name,
          reason: catalogRow
            ? 'Marked garmin_supported=false in catalog'
            : 'No matching catalog row',
        })
        continue
      }
      resolvedCategory = catalogRow.garmin_exercise_category
      resolvedName = catalogRow.garmin_exercise_name
      resolvedStepType = catalogRow.garmin_step_type
    }

    const repeatGroup = buildExerciseRepeatGroup(
      exercise,
      { category: resolvedCategory, exerciseName: resolvedName, stepType: resolvedStepType },
      stepOrder++,
    )
    steps.push(repeatGroup)
  }

  // Belt-and-braces: if no exercises landed, emit a single lap-button step so
  // the resulting Garmin workout is still valid. The API route guards against
  // this path but the mapper stays standalone-safe.
  if (steps.length === 0) {
    steps.push({
      type: 'ExecutableStepDTO',
      stepId: null,
      stepOrder: 1,
      childStepId: null,
      description: null,
      stepType: STRENGTH_STEP_TYPES.interval,
      endCondition: END_CONDITIONS.lapButton,
      endConditionValue: null,
      endConditionCompare: null,
      endConditionZone: null,
      targetType: NO_TARGET,
      targetValueOne: null,
      targetValueTwo: null,
      zoneNumber: null,
    })
  }

  return {
    payload: {
      workoutName: session.title,
      description: session.coaching_note ?? undefined,
      sportType: STRENGTH_SPORT_TYPE,
      workoutSegments: [
        {
          segmentOrder: 1,
          sportType: STRENGTH_SPORT_TYPE,
          workoutSteps: steps,
        },
      ],
    },
    skippedExercises,
  }
}

// ============================================================================
// Step builders
// ============================================================================

interface ResolvedExerciseEnums {
  category: string | null
  exerciseName: string | null
  stepType: StrengthExerciseCatalog['garmin_step_type']
}

function buildExerciseRepeatGroup(
  exercise: StrengthExercise,
  resolved: ResolvedExerciseEnums,
  stepOrder: number,
): GarminWorkoutStep {
  const m = exercise.measurement
  const childSteps: GarminWorkoutStep[] = []
  let childOrder = 1

  childSteps.push(buildExerciseStep(exercise, resolved, childOrder++))

  // Inject a REST step inside the repeat group when the athlete specified
  // rest_seconds. smartRepeat + skipLastRestStep tells Garmin to drop the
  // trailing rest on the final iteration.
  if (m.rest_seconds && m.rest_seconds > 0) {
    childSteps.push(buildRestStep(m.rest_seconds, childOrder++))
  }

  return {
    type: 'RepeatGroupDTO',
    stepId: null,
    stepOrder,
    childStepId: null,
    description: null,
    stepType: STRENGTH_STEP_TYPES.repeat,
    endCondition: END_CONDITIONS.iterations,
    endConditionValue: m.sets,
    endConditionCompare: null,
    endConditionZone: null,
    numberOfIterations: m.sets,
    smartRepeat: true,
    skipLastRestStep: true,
    targetType: NO_TARGET,
    targetValueOne: null,
    targetValueTwo: null,
    zoneNumber: null,
    workoutSteps: childSteps,
  }
}

function buildExerciseStep(
  exercise: StrengthExercise,
  resolved: ResolvedExerciseEnums,
  stepOrder: number,
): GarminWorkoutStep {
  const m = exercise.measurement

  // Map measurement → Garmin end condition.
  let endCondition: GarminEndCondition = END_CONDITIONS.reps
  let endConditionValue: number | null = null
  if (m.type === 'reps' && m.reps_per_set != null) {
    endCondition = END_CONDITIONS.reps
    endConditionValue = m.reps_per_set
  } else if (m.type === 'duration' && m.duration_seconds != null) {
    endCondition = END_CONDITIONS.time
    endConditionValue = m.duration_seconds
  } else if (m.type === 'distance' && m.distance_meters != null) {
    endCondition = END_CONDITIONS.distance
    endConditionValue = m.distance_meters
  } else {
    // No quantitative target — let the athlete press lap button to advance.
    endCondition = END_CONDITIONS.lapButton
    endConditionValue = null
  }

  return {
    type: 'ExecutableStepDTO',
    stepId: null,
    stepOrder,
    childStepId: null,
    description: exercise.notes ?? null,
    // Strength exercises use stepTypeId 3 (interval) per Garmin convention.
    // The exerciseName/category fields below identify the labelled exercise.
    stepType: STRENGTH_STEP_TYPES.interval,
    endCondition,
    endConditionValue,
    endConditionCompare: null,
    endConditionZone: null,
    targetType: NO_TARGET,
    targetValueOne: null,
    targetValueTwo: null,
    zoneNumber: null,
    category: resolved.category,
    exerciseName: resolved.exerciseName,
    weightValue: m.weight_kg ?? null,
    weightDisplayUnit: m.weight_kg != null ? KG_UNIT : null,
  }
}

function buildRestStep(restSeconds: number, stepOrder: number): GarminWorkoutStep {
  return {
    type: 'ExecutableStepDTO',
    stepId: null,
    stepOrder,
    childStepId: null,
    description: null,
    stepType: STRENGTH_STEP_TYPES.rest,
    endCondition: END_CONDITIONS.time,
    endConditionValue: restSeconds,
    endConditionCompare: null,
    endConditionZone: null,
    targetType: NO_TARGET,
    targetValueOne: null,
    targetValueTwo: null,
    zoneNumber: null,
  }
}
