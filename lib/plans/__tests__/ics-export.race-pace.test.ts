import { describe, it, expect } from 'vitest'
import { generateICS, type ICSWorkout } from '../ics-export'
import type { TrainingPaces } from '@/types/database'

const PACES: TrainingPaces = {
  easy: 330,
  marathon: 259,
  tempo: 240,
  interval: 213,
  repetition: 200,
  walk: 600,
}

function makeRaceWorkout(distanceMeters: number, id = 1): ICSWorkout {
  return {
    id,
    scheduled_date: '2026-07-12',
    workout_type: 'race',
    description: 'Goal race',
    distance_target_meters: distanceMeters,
    duration_target_seconds: null,
    intensity_target: 'race',
    structured_workout: null,
    status: 'scheduled',
    version: 0,
  }
}

function makeNonRaceWorkout(): ICSWorkout {
  return {
    id: 99,
    scheduled_date: '2026-07-05',
    workout_type: 'easy_run',
    description: 'Easy run',
    distance_target_meters: 8000,
    duration_target_seconds: null,
    intensity_target: 'easy',
    structured_workout: null,
    status: 'scheduled',
    version: 0,
  }
}

describe('generateICS — race-day workouts get no Target Pace line', () => {
  it('omits Target Pace for a 5K race', () => {
    const ics = generateICS({
      planName: 'Test',
      workouts: [makeRaceWorkout(5000)],
      trainingPaces: PACES,
    })
    expect(ics).not.toContain('Target Pace')
    // Sanity: race did get exported
    expect(ics).toContain('Goal race')
  })

  it('omits Target Pace for a 10K race', () => {
    const ics = generateICS({
      planName: 'Test',
      workouts: [makeRaceWorkout(10000)],
      trainingPaces: PACES,
    })
    expect(ics).not.toContain('Target Pace')
  })

  it('omits Target Pace for a half marathon race', () => {
    const ics = generateICS({
      planName: 'Test',
      workouts: [makeRaceWorkout(21097)],
      trainingPaces: PACES,
    })
    expect(ics).not.toContain('Target Pace')
  })

  it('omits Target Pace for a marathon race', () => {
    const ics = generateICS({
      planName: 'Test',
      workouts: [makeRaceWorkout(42195)],
      trainingPaces: PACES,
    })
    expect(ics).not.toContain('Target Pace')
  })

  it('still emits Target Pace on non-race workouts in the same plan (regression guard)', () => {
    // The race-only suppression must not leak to other workouts in the export.
    const ics = generateICS({
      planName: 'Test',
      workouts: [makeNonRaceWorkout(), makeRaceWorkout(10000)],
      trainingPaces: PACES,
    })
    // Easy run still has its pace line; race does not.
    expect(ics).toContain('Target Pace')
    // Verify it's the easy line specifically and not a race fall-through
    expect(ics).toMatch(/Target Pace:[^\\]*\(easy\)/)
  })
})
