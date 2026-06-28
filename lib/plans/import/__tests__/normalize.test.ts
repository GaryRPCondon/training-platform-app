import { describe, it, expect } from 'vitest'
import { normalizeParsedPlan } from '../normalize'
import type { ParsedRunningPlan, ImportedWeek } from '../schemas'

function week(weekIndex: number, partial?: Partial<ImportedWeek>): ImportedWeek {
  return {
    week_index: weekIndex,
    workouts: [
      { day_of_week: 2, type: 'easy_run', description: 'Easy 8 km', distance_meters: 8000, intensity: 'easy' },
      { day_of_week: 1, type: 'rest', description: 'Rest' },
    ],
    ...partial,
  }
}

function plan(partial?: Partial<ParsedRunningPlan>): ParsedRunningPlan {
  return {
    schema_version: '1.0',
    name: 'Test Plan',
    weeks: [week(1)],
    parse_warnings: [],
    ...partial,
  }
}

describe('normalizeParsedPlan', () => {
  it('re-indexes weeks to a dense ascending 1..N sequence', () => {
    const input = plan({ weeks: [week(17), week(15), week(16)] })
    const { plan: out, totalWeeks } = normalizeParsedPlan(input)
    expect(out.weeks.map(w => w.week_index)).toEqual([1, 2, 3])
    expect(totalWeeks).toBe(3)
  })

  it('sorts workouts within a week by day_of_week', () => {
    const { plan: out } = normalizeParsedPlan(plan())
    expect(out.weeks[0].workouts.map(w => w.day_of_week)).toEqual([1, 2])
  })

  it('maps a non-canonical intensity string to a canonical token', () => {
    const input = plan({
      weeks: [
        {
          week_index: 1,
          workouts: [
            {
              day_of_week: 3,
              type: 'intervals',
              description: 'VO2max session',
              distance_meters: 9000,
              // free-text intensity the LLM might emit
              intensity: 'general aerobic' as unknown as never,
            },
          ],
        },
      ],
    })
    const { plan: out } = normalizeParsedPlan(input)
    expect(out.weeks[0].workouts[0].intensity).toBe('easy')
  })

  it('nulls an unclassifiable intensity and warns', () => {
    const input = plan({
      weeks: [
        {
          week_index: 1,
          workouts: [
            {
              day_of_week: 3,
              type: 'intervals',
              description: 'mystery',
              distance_meters: 9000,
              intensity: 'wat' as unknown as never,
            },
          ],
        },
      ],
    })
    const { plan: out } = normalizeParsedPlan(input)
    expect(out.weeks[0].workouts[0].intensity).toBeNull()
    expect(out.parse_warnings.some(w => w.includes("couldn't classify"))).toBe(true)
  })

  it('warns when a running day has no distance, duration, or structure', () => {
    const input = plan({
      weeks: [
        {
          week_index: 1,
          workouts: [{ day_of_week: 2, type: 'easy_run', description: 'Easy run' }],
        },
      ],
    })
    const { plan: out } = normalizeParsedPlan(input)
    expect(out.parse_warnings.some(w => w.includes('no distance or duration'))).toBe(true)
  })

  it('does not warn for rest/cross-training days with no load', () => {
    const input = plan({
      weeks: [
        {
          week_index: 1,
          workouts: [
            { day_of_week: 1, type: 'rest', description: 'Rest' },
            { day_of_week: 3, type: 'cross_training', description: 'Bike 45 min' },
          ],
        },
      ],
    })
    const { plan: out } = normalizeParsedPlan(input)
    expect(out.parse_warnings).toEqual([])
  })

  it('resolves detected_race_week from the actual race workout after re-indexing', () => {
    const input = plan({
      detected_race_week: 99,
      weeks: [
        week(2),
        {
          week_index: 1,
          workouts: [{ day_of_week: 7, type: 'race', description: 'Goal race', distance_meters: 42195, intensity: 'race' }],
        },
      ],
    })
    const { plan: out } = normalizeParsedPlan(input)
    // week_index 1 was the lower stated index (race week sorted to position 1)
    expect(out.detected_race_week).toBe(1)
  })

  it('clamps a stated race week when there is no explicit race workout', () => {
    const input = plan({ detected_race_week: 99, weeks: [week(1), week(2)] })
    const { plan: out } = normalizeParsedPlan(input)
    expect(out.detected_race_week).toBe(2)
  })
})
