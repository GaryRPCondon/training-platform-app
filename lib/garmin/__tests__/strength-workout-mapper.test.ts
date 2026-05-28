import { describe, it, expect } from 'vitest'
import { mapStrengthSessionToGarmin } from '../strength-workout-mapper'
import type { StrengthExerciseCatalog, StrengthSession } from '@/types/database'

const catalog: StrengthExerciseCatalog[] = [
  {
    id: 1,
    canonical_name: 'pushup',
    display_name: 'Push-up',
    aliases: [],
    measurement_type: 'reps',
    garmin_exercise_category: 'CHEST',
    garmin_exercise_name: 'PUSH_UP',
    garmin_step_type: 'STRENGTH',
    garmin_supported: true,
    created_at: '2026-05-19T00:00:00Z',
  },
  {
    id: 2,
    canonical_name: 'plank',
    display_name: 'Plank',
    aliases: [],
    measurement_type: 'duration',
    garmin_exercise_category: 'CORE',
    garmin_exercise_name: 'PLANK',
    garmin_step_type: 'STRENGTH',
    garmin_supported: true,
    created_at: '2026-05-19T00:00:00Z',
  },
  {
    id: 3,
    canonical_name: 'foam_roll_quads',
    display_name: 'Foam Roll — Quads',
    aliases: [],
    measurement_type: 'duration',
    garmin_exercise_category: null,
    garmin_exercise_name: null,
    garmin_step_type: 'OTHER',
    garmin_supported: false,
    created_at: '2026-05-19T00:00:00Z',
  },
]

function baseSession(overrides: Partial<StrengthSession> = {}): StrengthSession {
  return {
    id: 1,
    program_id: 1,
    athlete_id: 'athlete-1',
    session_index: 1,
    scheduled_date: '2026-05-21',
    display_order: 1,
    title: 'Test session',
    exercises: [],
    estimated_duration_minutes: 30,
    placement_rationale: null,
    coaching_note: null,
    completion_status: 'pending',
    completed_at: null,
    actual_duration_minutes: null,
    completion_notes: null,
    garmin_workout_id: null,
    garmin_scheduled_at: null,
    garmin_sync_status: null,
    garmin_sync_metadata: null,
    created_at: '2026-05-19T00:00:00Z',
    updated_at: '2026-05-19T00:00:00Z',
    ...overrides,
  }
}

describe('mapStrengthSessionToGarmin', () => {
  it('wraps a rep-based exercise in a RepeatGroup with set count + skipLastRestStep', () => {
    const session = baseSession({
      title: 'Pushup test',
      exercises: [
        {
          canonical_name: 'pushup',
          display_name: 'Push-up',
          user_text: 'push-ups 3x10',
          measurement: { type: 'reps', sets: 3, reps_per_set: 10, rest_seconds: 60 },
          garmin_supported: true,
        },
      ],
    })

    const { payload, skippedExercises } = mapStrengthSessionToGarmin(session, catalog)

    expect(skippedExercises).toEqual([])
    expect(payload.workoutName).toBe('Pushup test')
    expect(payload.sportType.sportTypeKey).toBe('strength_training')

    const steps = payload.workoutSegments[0].workoutSteps
    expect(steps).toHaveLength(1)
    const group = steps[0]
    expect(group.type).toBe('RepeatGroupDTO')
    expect(group.numberOfIterations).toBe(3)
    expect(group.skipLastRestStep).toBe(true)
    expect(group.endCondition.conditionTypeKey).toBe('iterations')
    expect(group.workoutSteps).toHaveLength(2) // exercise + rest

    const exerciseStep = group.workoutSteps![0]
    expect(exerciseStep.type).toBe('ExecutableStepDTO')
    expect(exerciseStep.endCondition.conditionTypeKey).toBe('reps')
    expect(exerciseStep.endConditionValue).toBe(10)
    expect(exerciseStep.category).toBe('CHEST')
    expect(exerciseStep.exerciseName).toBe('PUSH_UP')

    const restStep = group.workoutSteps![1]
    expect(restStep.stepType.stepTypeKey).toBe('rest')
    expect(restStep.endCondition.conditionTypeKey).toBe('time')
    expect(restStep.endConditionValue).toBe(60)
  })

  it('omits the rest step when no rest_seconds is set', () => {
    const session = baseSession({
      exercises: [
        {
          canonical_name: 'plank',
          display_name: 'Plank',
          user_text: '3 x 30s plank',
          measurement: { type: 'duration', sets: 3, duration_seconds: 30 },
          garmin_supported: true,
        },
      ],
    })

    const { payload } = mapStrengthSessionToGarmin(session, catalog)
    const group = payload.workoutSegments[0].workoutSteps[0]
    expect(group.workoutSteps).toHaveLength(1)
    expect(group.workoutSteps![0].endCondition.conditionTypeKey).toBe('time')
    expect(group.workoutSteps![0].endConditionValue).toBe(30)
  })

  it('emits a label-only step (with display_name in description) for unknown exercises instead of skipping', () => {
    const session = baseSession({
      exercises: [
        {
          canonical_name: 'pushup',
          display_name: 'Push-up',
          user_text: 'pushup',
          measurement: { type: 'reps', sets: 3, reps_per_set: 10 },
          garmin_supported: true,
        },
        {
          canonical_name: 'unknown_exercise',
          display_name: 'Mystery move',
          user_text: 'mystery move',
          measurement: { type: 'reps', sets: 3, reps_per_set: 10 },
          garmin_supported: false,
        },
      ],
    })

    const { payload, mappings, skippedExercises } = mapStrengthSessionToGarmin(session, catalog)
    expect(skippedExercises).toEqual([])
    expect(mappings).toHaveLength(2)
    expect(mappings[0]).toEqual({ canonicalName: 'pushup', displayName: 'Push-up', tier: 'native' })
    expect(mappings[1]).toEqual({ canonicalName: 'unknown_exercise', displayName: 'Mystery move', tier: 'label_only' })

    expect(payload.workoutSegments[0].workoutSteps).toHaveLength(2)
    const mysteryGroup = payload.workoutSegments[0].workoutSteps[1]
    const mysteryStep = mysteryGroup.workoutSteps![0]
    expect(mysteryStep.category).toBeNull()
    expect(mysteryStep.exerciseName).toBeNull()
    expect(mysteryStep.description).toBe('Mystery move')
  })

  it('emits a label-only step for catalog rows marked garmin_supported=false without a known fallback', () => {
    const session = baseSession({
      exercises: [
        {
          canonical_name: 'foam_roll_quads',
          display_name: 'Foam Roll — Quads',
          user_text: 'foam roll quads 60s',
          measurement: { type: 'duration', sets: 1, duration_seconds: 60 },
          garmin_supported: false,
          notes: 'gentle',
        },
      ],
    })

    const { payload, mappings, skippedExercises } = mapStrengthSessionToGarmin(session, catalog)
    expect(skippedExercises).toEqual([])
    expect(mappings).toEqual([
      { canonicalName: 'foam_roll_quads', displayName: 'Foam Roll — Quads', tier: 'label_only' },
    ])
    expect(payload.workoutSegments[0].workoutSteps).toHaveLength(1)
    const group = payload.workoutSegments[0].workoutSteps[0]
    const step = group.workoutSteps![0]
    expect(step.category).toBeNull()
    expect(step.exerciseName).toBeNull()
    // Display name + notes are surfaced in the description so the watch shows
    // something meaningful even without a Garmin enum.
    expect(step.description).toBe('Foam Roll — Quads — gentle')
  })

  it('uses a known generic fallback (LUNGE/LUNGE) for bodyweight lunge with no catalog row', () => {
    const session = baseSession({
      exercises: [
        {
          canonical_name: 'lunge',
          display_name: 'Lunge',
          user_text: 'lunges 3x10',
          measurement: { type: 'reps', sets: 3, reps_per_set: 10 },
          garmin_supported: false,
        },
      ],
    })

    const { payload, mappings } = mapStrengthSessionToGarmin(session, catalog)
    expect(mappings).toEqual([
      { canonicalName: 'lunge', displayName: 'Lunge', tier: 'fallback' },
    ])
    const step = payload.workoutSegments[0].workoutSteps[0].workoutSteps![0]
    expect(step.category).toBe('LUNGE')
    expect(step.exerciseName).toBe('LUNGE')
  })

  it('uses a WARM_UP fallback for bird_dog with no catalog row', () => {
    const session = baseSession({
      exercises: [
        {
          canonical_name: 'bird_dog',
          display_name: 'Bird Dog',
          user_text: 'bird dog 3x10',
          measurement: { type: 'reps', sets: 3, reps_per_set: 10 },
          garmin_supported: false,
        },
      ],
    })

    const { payload, mappings } = mapStrengthSessionToGarmin(session, catalog)
    expect(mappings[0].tier).toBe('fallback')
    const step = payload.workoutSegments[0].workoutSteps[0].workoutSteps![0]
    expect(step.category).toBe('WARM_UP')
    expect(step.exerciseName).toBe('OPPOSITE_ARM_AND_LEG_BALANCE')
  })

  it('passes weight_kg through with the kilogram unit', () => {
    const session = baseSession({
      exercises: [
        {
          canonical_name: 'pushup',
          display_name: 'Push-up',
          user_text: 'pushup',
          measurement: { type: 'reps', sets: 3, reps_per_set: 10, weight_kg: 5 },
          garmin_supported: true,
        },
      ],
    })

    const { payload } = mapStrengthSessionToGarmin(session, catalog)
    const exerciseStep = payload.workoutSegments[0].workoutSteps[0].workoutSteps![0]
    expect(exerciseStep.weightValue).toBe(5)
    expect(exerciseStep.weightDisplayUnit?.unitKey).toBe('kilogram')
  })
})
