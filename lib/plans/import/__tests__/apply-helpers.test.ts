import { describe, it, expect } from 'vitest'
import {
  normalizeRaceDistance,
  ensureRaceWorkout,
  deriveAnchorDates,
  buildParsedPlan,
  derivePhaseRanges,
} from '../apply'
import type { ImportedWeek } from '../schemas'
import type { AllTrainingPaces } from '@/lib/training/vdot'

const paces: AllTrainingPaces = {
  easy: 330, marathon: 300, tempo: 280, interval: 255, repetition: 240, walk: 600,
}

describe('normalizeRaceDistance', () => {
  it('maps common forms', () => {
    expect(normalizeRaceDistance('marathon')).toBe('marathon')
    expect(normalizeRaceDistance('Half')).toBe('half_marathon')
    expect(normalizeRaceDistance('half marathon')).toBe('half_marathon')
    expect(normalizeRaceDistance('5K')).toBe('5k')
    expect(normalizeRaceDistance('10 mile')).toBe('10_mile')
  })
  it('returns null for unknown', () => {
    expect(normalizeRaceDistance('ultra')).toBeNull()
  })
})

describe('ensureRaceWorkout', () => {
  it('keeps an existing race workout and reports its day', () => {
    const weeks: ImportedWeek[] = [
      { week_index: 1, workouts: [{ day_of_week: 6, type: 'race', description: 'Race', distance_meters: 5000, intensity: 'race' }] },
    ]
    const r = ensureRaceWorkout(weeks, '5k')
    expect(r.raceDay).toBe(6)
    expect(r.weeks).toBe(weeks)
  })

  it('appends a Sunday race when none present', () => {
    const weeks: ImportedWeek[] = [
      { week_index: 1, workouts: [{ day_of_week: 2, type: 'easy_run', description: 'Easy', distance_meters: 8000, intensity: 'easy' }] },
    ]
    const r = ensureRaceWorkout(weeks, 'marathon')
    expect(r.raceDay).toBe(7)
    const last = r.weeks[r.weeks.length - 1]
    const race = last.workouts.find(w => w.type === 'race')
    expect(race?.day_of_week).toBe(7)
    expect(race?.distance_meters).toBe(42195)
  })
})

describe('deriveAnchorDates', () => {
  it('lands the race on race day and counts weeks back', () => {
    // race on Sunday 2026-04-19 (day 7), 15 fitted weeks
    const { planStartDate, goalDate } = deriveAnchorDates('2026-04-19', 7, 15)
    expect(goalDate).toBe('2026-04-19')
    // finalWeekStart = race - 6 days = 2026-04-13. start = -14 weeks = 2026-01-05
    expect(planStartDate).toBe('2026-01-05')
  })

  it('handles a mid-week race day', () => {
    // race on Wednesday (day 3), 1 week
    const { planStartDate } = deriveAnchorDates('2026-04-15', 3, 1)
    // finalWeekStart = race - 2 days = 2026-04-13
    expect(planStartDate).toBe('2026-04-13')
  })
})

describe('buildParsedPlan', () => {
  const weeks: ImportedWeek[] = [
    {
      week_index: 1,
      phase: 'base',
      workouts: [
        { day_of_week: 1, type: 'rest', description: 'Rest' },
        { day_of_week: 2, type: 'easy_run', description: 'Easy 8 km', distance_meters: 8000, intensity: 'easy' },
        { day_of_week: 4, type: 'intervals', description: '5x600 @ 5k', distance_meters: 9000, intensity: 'vo2max', pace_literal: null },
        { day_of_week: 6, type: 'tempo', description: 'Tempo', distance_meters: 10000, intensity: 'threshold', pace_literal: '4:00/km' },
      ],
    },
  ]

  it('maps to ParsedPlan with indices, volume and pace stamping', () => {
    const plan = buildParsedPlan(weeks, paces)
    expect(plan.weeks).toHaveLength(1)
    const w = plan.weeks[0]
    expect(w.week_number).toBe(1)
    expect(w.phase).toBe('base')
    expect(w.weekly_total_km).toBe(27) // (8000+9000+10000)/1000
    expect(w.workouts.map(x => x.workout_index)).toEqual(['W1:D1', 'W1:D2', 'W1:D4', 'W1:D6'])

    // rest day: empty intensity, no structured pace
    expect(w.workouts[0].intensity).toBe('')

    // vo2max -> interval pace key, VDOT-resolved
    const intervals = w.workouts[2]
    expect(intervals.intensity).toBe('interval')
    expect((intervals.structured_workout as Record<string, unknown>).target_pace_sec_per_km).toBe(255)
    expect((intervals.structured_workout as Record<string, unknown>).pace_source).toBe('vdot')

    // tempo with literal pace wins over VDOT
    const tempo = w.workouts[3]
    expect(tempo.intensity).toBe('tempo')
    expect((tempo.structured_workout as Record<string, unknown>).target_pace_sec_per_km).toBe(240)
    expect((tempo.structured_workout as Record<string, unknown>).pace_source).toBe('literal')
  })

})

describe('derivePhaseRanges', () => {
  function pweek(week_index: number, phase: 'base' | 'build' | 'peak' | 'taper' | null): ImportedWeek {
    return { week_index, phase, workouts: [{ day_of_week: 2, type: 'easy_run', description: 'Easy', distance_meters: 8000, intensity: 'easy' }] }
  }

  it('collapses contiguous phase runs into ranges', () => {
    const weeks = [pweek(1, 'base'), pweek(2, 'base'), pweek(3, 'build'), pweek(4, 'peak'), pweek(5, 'taper')]
    expect(derivePhaseRanges(weeks)).toEqual([
      { name: 'base', startWeek: 1, endWeek: 2 },
      { name: 'build', startWeek: 3, endWeek: 3 },
      { name: 'peak', startWeek: 4, endWeek: 4 },
      { name: 'taper', startWeek: 5, endWeek: 5 },
    ])
  })

  it('returns null when any week is unlabelled', () => {
    expect(derivePhaseRanges([pweek(1, 'base'), pweek(2, null)])).toBeNull()
    expect(derivePhaseRanges([])).toBeNull()
  })
})

describe('buildParsedPlan extra', () => {
  it('leaves structured_workout null for a plain run when no athlete paces', () => {
    const plan = buildParsedPlan(
      [{ week_index: 1, workouts: [{ day_of_week: 2, type: 'easy_run', description: 'Easy', distance_meters: 8000, intensity: 'easy' }] }],
      null,
    )
    expect(plan.weeks[0].workouts[0].structured_workout).toBeNull()
  })
})
