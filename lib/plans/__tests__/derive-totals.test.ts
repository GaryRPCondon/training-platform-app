import { describe, it, expect } from 'vitest'
import { deriveTotals } from '../derive-totals'
import type { ParsedPlan, ParsedWorkout } from '../response-parser'

const PACES = { easy: 309, marathon: 256, tempo: 242, interval: 222, repetition: 208, walk: 600 }

function workout(overrides: Partial<ParsedWorkout> = {}): ParsedWorkout {
  return {
    day: 6,
    workout_index: 'W3:D6',
    type: 'long_run',
    description: 'Long run',
    distance_meters: null,
    intensity: 'easy',
    pace_guidance: null,
    notes: null,
    ...overrides,
  }
}

function plan(...workouts: ParsedWorkout[]): ParsedPlan {
  return { weeks: [{ week_number: 3, phase: 'base', weekly_total_km: 0, workouts }] }
}

describe('deriveTotals — duration targets', () => {
  it('stamps duration_seconds on a purely time-prescribed workout', () => {
    // Daniels "steady E run of 90-120 min" — stored as a single 5400 s easy interval
    // with no distance anywhere. Without a duration target this gets scored against a
    // derived distance, so running the prescribed 90 min can be marked short.
    const w = workout({
      structured_workout: {
        main_set: [{ repeat: 1, intervals: [{ role: 'work', intensity: 'easy', duration_seconds: 5400 }] }],
      },
    })
    const p = plan(w)
    deriveTotals(p, PACES)

    expect(w.duration_seconds).toBe(5400)
    // Distance is still derived for volume planning — it is just no longer the target.
    expect(w.distance_meters).toBe(Math.round((5400 / 309) * 1000))
  })

  it('leaves duration_seconds unset on a distance-prescribed workout', () => {
    const w = workout({
      type: 'easy_run',
      structured_workout: {
        main_set: [{ repeat: 1, intervals: [{ role: 'work', intensity: 'easy', distance_meters: 9654 }] }],
      },
    })
    deriveTotals(plan(w), PACES)

    expect(w.duration_seconds).toBeUndefined()
    expect(w.distance_meters).toBe(9654)
  })

  it('leaves duration_seconds unset on a mixed distance/time workout', () => {
    // Distance is a real target here — the tempo reps are prescribed in miles.
    const w = workout({
      structured_workout: {
        main_set: [
          { repeat: 2, intervals: [
            { role: 'work', intensity: 'tempo', distance_meters: 1609 },
            { role: 'rest', intensity: 'rest', duration_seconds: 60 },
          ] },
          { repeat: 1, intervals: [{ role: 'recovery', intensity: 'easy', duration_seconds: 1800 }] },
        ],
      },
    })
    deriveTotals(plan(w), PACES)

    expect(w.duration_seconds).toBeUndefined()
  })

  it('still derives weekly volume across mixed workout kinds', () => {
    const timed = workout({
      structured_workout: {
        main_set: [{ repeat: 1, intervals: [{ role: 'work', intensity: 'easy', duration_seconds: 5400 }] }],
      },
    })
    const measured = workout({
      type: 'easy_run',
      structured_workout: {
        main_set: [{ repeat: 1, intervals: [{ role: 'work', intensity: 'easy', distance_meters: 10000 }] }],
      },
    })
    const p = plan(timed, measured)
    deriveTotals(p, PACES)

    const expected = Math.round((5400 / 309) * 1000) + 10000
    expect(p.weeks[0].weekly_total_km).toBe(Math.round(expected / 100) / 10)
  })
})
