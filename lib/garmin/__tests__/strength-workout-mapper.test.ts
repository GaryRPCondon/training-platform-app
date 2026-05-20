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

  it('skips exercises with no catalog row and reports them', () => {
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

    const { payload, skippedExercises } = mapStrengthSessionToGarmin(session, catalog)
    expect(skippedExercises).toHaveLength(1)
    expect(skippedExercises[0].canonicalName).toBe('unknown_exercise')
    expect(payload.workoutSegments[0].workoutSteps).toHaveLength(1) // only pushup landed
  })

  it('skips exercises whose catalog row has garmin_supported=false', () => {
    const session = baseSession({
      exercises: [
        {
          canonical_name: 'foam_roll_quads',
          display_name: 'Foam Roll — Quads',
          user_text: 'foam roll quads 60s',
          measurement: { type: 'duration', sets: 1, duration_seconds: 60 },
          garmin_supported: false,
        },
      ],
    })

    const { payload, skippedExercises } = mapStrengthSessionToGarmin(session, catalog)
    expect(skippedExercises).toHaveLength(1)
    expect(skippedExercises[0].reason).toMatch(/garmin_supported=false/)
    // Empty list falls back to a single lap-button step (mapper safety guard).
    expect(payload.workoutSegments[0].workoutSteps).toHaveLength(1)
    expect(payload.workoutSegments[0].workoutSteps[0].endCondition.conditionTypeKey).toBe('lap.button')
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
