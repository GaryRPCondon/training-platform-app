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

describe('mapToGarminWorkout — template pace_targets drive label resolution', () => {
  // Mirrors the bespoke_post_marathon_10k template: single-letter labels
  // map to athlete training/race paces.
  const PACE_TARGETS = {
    E: { reference_pace: 'easy', description: 'Easy pace' },
    T: { reference_pace: 'tempo', description: 'Threshold pace' },
    I: { reference_pace: 'interval', description: 'Interval/VO2max pace' },
    R10: { reference_pace: 'race_10k', description: 'Goal 10K race pace' },
  } as const
  const PACES_WITH_RACE: TrainingPaces & { race_10k: number } = {
    ...PACES,
    race_10k: 245,
  }

  it('resolves single-letter "E" warmup to easy pace, NOT the workout-level tempo pace', () => {
    // Regression: TempoBug.png — a Q1 tempo workout had warmup/cooldown/recovery
    // all transmitted at tempo pace because "E" did not match any substring in
    // the legacy intensity matcher and fell through to getWorkoutPaceType('tempo').
    const result = mapToGarminWorkout(makeWorkout({
      workout_type: 'tempo',
      intensity_target: 'T',
      structured_workout: {
        warmup: { duration_minutes: 15, intensity: 'E' },
        main_set: [{
          repeat: 4,
          intervals: [
            { distance_meters: 1000, intensity: 'T' },
            { distance_meters: 250, intensity: 'E' },  // recovery jog
          ],
        }],
        cooldown: { duration_minutes: 10, intensity: 'E' },
        // Plan-writer stamps the workout's primary intensity (T → tempo, 253 sec/km)
        target_pace_sec_per_km: 253,
      },
    }), PACES_WITH_RACE, PACE_TARGETS)

    const steps = result.workoutSegments[0].workoutSteps
    const warmup = steps[0]
    const cooldown = steps[2]
    const repeatGroup = steps[1]
    const [work, recovery] = repeatGroup.workoutSteps as [GarminWorkoutStep, GarminWorkoutStep]

    // Warmup: easy pace (PACES.easy = 330 sec/km → ~3.03 m/s)
    const easyMps = 1000 / 330
    expect(warmup.targetType.workoutTargetTypeKey).toBe('pace.zone')
    expect(warmup.targetValueOne).toBeCloseTo(1000 / (330 + 15), 2)
    expect(warmup.targetValueTwo).toBeCloseTo(1000 / (330 - 15), 2)
    // Sanity: warmup pace must NOT be the tempo pace (253 sec/km → ~3.95 m/s)
    expect(warmup.targetValueOne).toBeLessThan(easyMps)

    // Recovery jog at "E": easy pace, NOT tempo
    expect(recovery.stepType.stepTypeKey).toBe('interval')  // step type can be either
    expect(recovery.targetValueOne).toBeCloseTo(1000 / (330 + 15), 2)

    // Work intervals at "T": tempo pace (matches workout primary intensity → uses stamped pace)
    expect(work.targetType.workoutTargetTypeKey).toBe('pace.zone')
    expect(work.targetValueOne).toBeCloseTo(1000 / (253 + 15), 2)

    // Cooldown: easy pace
    expect(cooldown.targetValueOne).toBeCloseTo(1000 / (330 + 15), 2)
  })

  it('resolves Pfitz-style labels (vo2max, lactate_threshold) via pace_targets', () => {
    const PFITZ_TARGETS = {
      general_aerobic: { reference_pace: 'easy', description: 'GA' },
      vo2max: { reference_pace: 'interval', description: 'VO2max' },
      lactate_threshold: { reference_pace: 'tempo', description: 'LT' },
    } as const
    const result = mapToGarminWorkout(makeWorkout({
      workout_type: 'intervals',
      intensity_target: 'vo2max',
      structured_workout: {
        warmup: { duration_minutes: 15, intensity: 'general_aerobic' },
        main_set: [{
          repeat: 5,
          intervals: [{ distance_meters: 1000, intensity: 'vo2max' }],
        }],
      },
    }), PACES, PFITZ_TARGETS)

    const warmup = result.workoutSegments[0].workoutSteps[0]
    // general_aerobic → easy pace (330 sec/km)
    expect(warmup.targetValueOne).toBeCloseTo(1000 / (330 + 15), 2)

    const work = result.workoutSegments[0].workoutSteps[1].workoutSteps![0]
    // vo2max → interval pace (224 sec/km)
    expect(work.targetValueOne).toBeCloseTo(1000 / (224 + 15), 2)
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
