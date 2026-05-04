import { describe, it, expect } from 'vitest'
import { mapToGarminWorkout } from '../workout-mapper'
import type { TrainingPaces } from '@/types/database'
import type { GarminWorkoutStep } from '../types'

// VDOT ~50 athlete paces (seconds/km)
const PACES: TrainingPaces = {
  easy: 330,
  marathon: 275,
  tempo: 253,
  interval: 224,
  repetition: 210,
  walk: 600,
}

// Minimal PlannedWorkout shape — mapToGarminWorkout only consumes a Pick<>
function makeWorkout(overrides: Partial<{
  description: string
  workout_type: string
  distance_target_meters: number | null
  duration_target_seconds: number | null
  intensity_target: string | null
  structured_workout: Record<string, unknown> | null
}> = {}) {
  return {
    description: 'Test workout',
    workout_type: 'intervals',
    distance_target_meters: null,
    duration_target_seconds: null,
    intensity_target: 'tempo',
    structured_workout: null,
    ...overrides,
  } as Parameters<typeof mapToGarminWorkout>[0]
}

describe('mapToGarminWorkout — end conditions', () => {
  it('maps a distance-based step to Garmin distance end condition', () => {
    const result = mapToGarminWorkout(makeWorkout({
      workout_type: 'intervals',
      structured_workout: {
        main_set: [{
          repeat: 1,
          intervals: [{ distance_meters: 1000, intensity: 'tempo' }],
        }],
      },
    }), PACES)

    const step = result.workoutSegments[0].workoutSteps[0]
    expect(step.type).toBe('RepeatGroupDTO')
    const child = step.workoutSteps![0]
    expect(child.endCondition.conditionTypeKey).toBe('distance')
    expect(child.endConditionValue).toBe(1000)
  })

  it('maps a duration-based step (duration_seconds) to Garmin time end condition', () => {
    const result = mapToGarminWorkout(makeWorkout({
      workout_type: 'tempo',
      structured_workout: {
        main_set: [{
          repeat: 1,
          intervals: [{ duration_seconds: 600, intensity: 'tempo' }],
        }],
      },
    }), PACES)

    const child = result.workoutSegments[0].workoutSteps[0].workoutSteps![0]
    expect(child.endCondition.conditionTypeKey).toBe('time')
    expect(child.endConditionValue).toBe(600)
  })

  it('maps a duration-based step (duration_minutes on warmup) to Garmin time end condition', () => {
    const result = mapToGarminWorkout(makeWorkout({
      workout_type: 'intervals',
      structured_workout: {
        warmup: { duration_minutes: 15, intensity: 'easy' },
        main_set: [{ repeat: 1, intervals: [{ distance_meters: 1000, intensity: 'tempo' }]}],
      },
    }), PACES)

    const warmup = result.workoutSegments[0].workoutSteps[0]
    expect(warmup.stepType.stepTypeKey).toBe('warmup')
    expect(warmup.endCondition.conditionTypeKey).toBe('time')
    expect(warmup.endConditionValue).toBe(15 * 60)
  })
})

describe('mapToGarminWorkout — mixed distance/duration in one repeat group', () => {
  it('maps each child step independently when distance and duration are mixed', () => {
    // Fixture: 3km @ T pace, then 4 × (90s @ I pace, 60s jog).
    // The 4× repeat group mixes a duration-based work step with a duration-based recovery,
    // and the workout overall contains both a distance step and duration steps.
    const result = mapToGarminWorkout(makeWorkout({
      workout_type: 'intervals',
      intensity_target: 'tempo',
      structured_workout: {
        warmup: { duration_minutes: 15, intensity: 'easy' },
        main_set: [
          // Single 3km tempo block
          { repeat: 1, intervals: [{ distance_meters: 3000, intensity: 'tempo' }]},
          // Easy jog interval before the repeats (distance)
          { repeat: 1, intervals: [{ distance_meters: 400, intensity: 'recovery' }]},
          // 4 × 90s @ I pace, 60s jog — mixed within a single child interval list
          {
            repeat: 4,
            intervals: [
              { duration_seconds: 90, intensity: 'interval' },
              { duration_seconds: 60, intensity: 'recovery' },
            ],
          },
        ],
        cooldown: { duration_minutes: 10, intensity: 'easy' },
      },
    }), PACES)

    const steps = result.workoutSegments[0].workoutSteps
    // warmup + 3 main_set groups + cooldown = 5 top-level steps
    expect(steps).toHaveLength(5)

    // First main_set entry (3km tempo) — single repeat
    const tempoBlock = steps[1]
    expect(tempoBlock.type).toBe('RepeatGroupDTO')
    const tempoChild = tempoBlock.workoutSteps![0]
    expect(tempoChild.endCondition.conditionTypeKey).toBe('distance')
    expect(tempoChild.endConditionValue).toBe(3000)
    expect(tempoChild.stepType.stepTypeKey).toBe('interval')

    // Mixed-mode repeat group (4 × 90s/60s)
    const mixedRepeat = steps[3]
    expect(mixedRepeat.type).toBe('RepeatGroupDTO')
    expect(mixedRepeat.numberOfIterations).toBe(4)
    expect(mixedRepeat.workoutSteps).toHaveLength(2)
    const [work, rest] = mixedRepeat.workoutSteps as [GarminWorkoutStep, GarminWorkoutStep]
    expect(work.endCondition.conditionTypeKey).toBe('time')
    expect(work.endConditionValue).toBe(90)
    expect(work.stepType.stepTypeKey).toBe('interval')
    expect(rest.endCondition.conditionTypeKey).toBe('time')
    expect(rest.endConditionValue).toBe(60)
    expect(rest.stepType.stepTypeKey).toBe('recovery')
  })
})

describe('mapToGarminWorkout — repeat group structure', () => {
  it('builds warmup + RepeatGroupDTO + cooldown for a structured intervals workout', () => {
    const result = mapToGarminWorkout(makeWorkout({
      workout_type: 'intervals',
      intensity_target: 'interval',
      structured_workout: {
        warmup: { duration_minutes: 15, intensity: 'easy' },
        main_set: [{
          repeat: 5,
          intervals: [
            { distance_meters: 1000, intensity: 'interval' },
            { duration_seconds: 90, intensity: 'recovery' },
          ],
        }],
        cooldown: { duration_minutes: 10, intensity: 'easy' },
      },
    }), PACES)

    const steps = result.workoutSegments[0].workoutSteps
    expect(steps).toHaveLength(3)
    expect(steps[0].stepType.stepTypeKey).toBe('warmup')
    expect(steps[1].type).toBe('RepeatGroupDTO')
    expect(steps[1].numberOfIterations).toBe(5)
    expect(steps[2].stepType.stepTypeKey).toBe('cooldown')
  })

  it('sets smartRepeat=true and skipLastRestStep from skip_last_recovery', () => {
    const result = mapToGarminWorkout(makeWorkout({
      workout_type: 'intervals',
      structured_workout: {
        main_set: [{
          repeat: 3,
          skip_last_recovery: true,
          intervals: [
            { distance_meters: 800, intensity: 'interval' },
            { distance_meters: 400, intensity: 'recovery' },
          ],
        }],
      },
    }), PACES)

    const repeatStep = result.workoutSegments[0].workoutSteps[0]
    expect(repeatStep.smartRepeat).toBe(true)
    expect(repeatStep.skipLastRestStep).toBe(true)
  })
})

describe('mapToGarminWorkout — pace targeting', () => {
  it('stamps a pace zone target on tempo intervals derived from training paces', () => {
    const result = mapToGarminWorkout(makeWorkout({
      workout_type: 'tempo',
      intensity_target: 'tempo',
      structured_workout: {
        main_set: [{ repeat: 1, intervals: [{ distance_meters: 5000, intensity: 'tempo' }]}],
      },
    }), PACES)

    const child = result.workoutSegments[0].workoutSteps[0].workoutSteps![0]
    expect(child.targetType.workoutTargetTypeKey).toBe('pace.zone')
    // tempo = 253 sec/km → Garmin m/s with ±15 sec/km tolerance band; both bounds positive numbers
    expect(child.targetValueOne).toBeGreaterThan(0)
    expect(child.targetValueTwo).toBeGreaterThan(child.targetValueOne!)
  })

  it('preserves a stamped pace target via target_pace_sec_per_km override', () => {
    const result = mapToGarminWorkout(makeWorkout({
      workout_type: 'intervals',
      intensity_target: 'race_10k',
      structured_workout: {
        main_set: [{
          repeat: 5,
          intervals: [{ distance_meters: 1000, intensity: 'race_10k' }],
        }],
        // Stamped by pace-resolver at plan-write time (race_10k → 255 sec/km for VDOT 50)
        target_pace_sec_per_km: 255,
      },
    }), PACES)

    const child = result.workoutSegments[0].workoutSteps[0].workoutSteps![0]
    expect(child.targetType.workoutTargetTypeKey).toBe('pace.zone')
    // Both bounds set; stamped pace string 4:15 → ±15 sec/km tolerance
    expect(child.targetValueOne).toBeGreaterThan(0)
    expect(child.targetValueTwo).toBeGreaterThan(child.targetValueOne!)
  })

  it('omits pace target on walk segments to avoid false compliance warnings', () => {
    const result = mapToGarminWorkout(makeWorkout({
      workout_type: 'easy_run',
      intensity_target: 'easy',
      structured_workout: {
        main_set: [{
          repeat: 1,
          intervals: [{ duration_seconds: 600, intensity: 'walk' }],
        }],
      },
    }), PACES)

    const child = result.workoutSegments[0].workoutSteps[0].workoutSteps![0]
    expect(child.targetType.workoutTargetTypeKey).toBe('no.target')
    expect(child.targetValueOne).toBeNull()
  })
})

describe('mapToGarminWorkout — simple workouts', () => {
  it('emits a single distance-based step for a non-structured easy run', () => {
    const result = mapToGarminWorkout(makeWorkout({
      workout_type: 'easy_run',
      distance_target_meters: 8000,
      intensity_target: 'easy',
      structured_workout: null,
    }), PACES)

    const steps = result.workoutSegments[0].workoutSteps
    expect(steps).toHaveLength(1)
    expect(steps[0].type).toBe('ExecutableStepDTO')
    expect(steps[0].endCondition.conditionTypeKey).toBe('distance')
    expect(steps[0].endConditionValue).toBe(8000)
  })

  it('uses workout description as the workoutName', () => {
    const result = mapToGarminWorkout(makeWorkout({
      description: '5×1km @ 10K race pace',
      workout_type: 'intervals',
    }), PACES)

    expect(result.workoutName).toBe('5×1km @ 10K race pace')
  })
})

describe('mapToGarminWorkout — race-day workouts get no pace target', () => {
  function raceFixture(distanceMeters: number) {
    return makeWorkout({
      description: 'Goal race',
      workout_type: 'race',
      distance_target_meters: distanceMeters,
      intensity_target: 'race',
      structured_workout: null,
    })
  }

  it('omits pace target for a 5K race workout', () => {
    const result = mapToGarminWorkout(raceFixture(5000), PACES)
    const step = result.workoutSegments[0].workoutSteps[0]
    expect(step.targetType.workoutTargetTypeKey).toBe('no.target')
    expect(step.targetValueOne).toBeNull()
    expect(step.targetValueTwo).toBeNull()
  })

  it('omits pace target for a 10K race workout', () => {
    const result = mapToGarminWorkout(raceFixture(10000), PACES)
    const step = result.workoutSegments[0].workoutSteps[0]
    expect(step.targetType.workoutTargetTypeKey).toBe('no.target')
    expect(step.targetValueOne).toBeNull()
  })

  it('omits pace target for a half marathon race workout', () => {
    const result = mapToGarminWorkout(raceFixture(21097), PACES)
    const step = result.workoutSegments[0].workoutSteps[0]
    expect(step.targetType.workoutTargetTypeKey).toBe('no.target')
    expect(step.targetValueOne).toBeNull()
  })

  it('omits pace target for a marathon race workout', () => {
    const result = mapToGarminWorkout(raceFixture(42195), PACES)
    const step = result.workoutSegments[0].workoutSteps[0]
    expect(step.targetType.workoutTargetTypeKey).toBe('no.target')
    expect(step.targetValueOne).toBeNull()
  })
})
