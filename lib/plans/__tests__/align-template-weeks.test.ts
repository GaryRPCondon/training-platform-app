import { describe, it, expect } from 'vitest'
import {
  alignTemplateWeeks,
  alignTemplateWeeksForPlan,
  hasPrescribedPerWeekRows,
  hasPrescribedWork,
} from '../align-template-weeks'
import type { FullTemplate, WeekSchedule } from '@/lib/templates/types'

/** An 18-row JD-2Q-shaped schedule: countdown `week` 18→1, `plan_week` 1→18,
 *  with the final row content-free (its content lives in `daily_schedule`). */
function jdRows(): WeekSchedule[] {
  const rows: WeekSchedule[] = []
  for (let planWeek = 1; planWeek <= 17; planWeek++) {
    rows.push({
      week: 19 - planWeek,
      plan_week: planWeek,
      Q1: `Q1 for plan_week ${planWeek}`,
      Q1_km: 20 + planWeek,
      Q2: `Q2 for plan_week ${planWeek}`,
      Q2_km: 20,
      E_days_total_km: 30,
      E_days_distribution: [{ day: 'Monday', km: 10, mileage: 6 }],
      total_km: 70 + planWeek,
    })
  }
  rows.push({ week: 1, plan_week: 18, total_km: 66 })  // race week
  return rows
}

const JD_TEMPLATE = {
  template_id: 'jd-2q-41-55',
  name: 'JD 2Q 41-55',
  duration_weeks: 18,
  weekly_schedule: jdRows(),
  race_week: {
    day_before_race: 'easy_shakeout',
    guidance: 'Short easy shakeout the day before.',
  },
} as unknown as FullTemplate

describe('hasPrescribedWork', () => {
  it('rejects a content-free race-week row', () => {
    expect(hasPrescribedWork({ week: 1, plan_week: 18, total_km: 66 })).toBe(false)
  })

  it('accepts aggregate-only rows that drive the PER-WEEK TARGETS fallback', () => {
    expect(hasPrescribedWork({ week: 1, plan_week: 1, total_km: 79, Q1_km: 24, Q2_km: 21 })).toBe(true)
  })

  it('accepts day-name rows (Pfitz/Hansons/Magness shape)', () => {
    expect(hasPrescribedWork({ week: 1, tuesday: 'Easy 8km' })).toBe(true)
  })

  it('accepts workouts-object rows (Hal Higdon shape)', () => {
    expect(hasPrescribedWork({ week: 1, workouts: { monday: { type: 'easy_run' } } })).toBe(true)
  })
})

describe('alignTemplateWeeks', () => {
  it('drops the earliest weeks and keeps the tail when the plan is shorter', () => {
    const aligned = alignTemplateWeeks(jdRows(), 14)
    expect(aligned).toHaveLength(14)
    // Race week row excluded, so the 17 usable rows keep their LAST 14: plan_week 4..17
    expect(aligned[0].Q1).toBe('Q1 for plan_week 4')
    expect(aligned[13].Q1).toBe('Q1 for plan_week 17')
  })

  it('renumbers plan_week contiguously from 1', () => {
    const aligned = alignTemplateWeeks(jdRows(), 14)
    expect(aligned.map(w => w.plan_week)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
  })

  it('is identity (bar the dropped race week) when the counts already match', () => {
    const aligned = alignTemplateWeeks(jdRows(), 17)
    expect(aligned).toHaveLength(17)
    expect(aligned[0].Q1).toBe('Q1 for plan_week 1')
    expect(aligned[16].Q1).toBe('Q1 for plan_week 17')
  })

  it('repeats the earliest retained week at the front when the plan is longer', () => {
    const aligned = alignTemplateWeeks(jdRows(), 19)
    expect(aligned).toHaveLength(19)
    expect(aligned[0].Q1).toBe('Q1 for plan_week 1')
    expect(aligned[1].Q1).toBe('Q1 for plan_week 1')
    expect(aligned[2].Q1).toBe('Q1 for plan_week 1')
    expect(aligned[18].Q1).toBe('Q1 for plan_week 17')
  })

  it('always excludes the content-free race-week row', () => {
    for (const target of [5, 14, 17, 19]) {
      expect(alignTemplateWeeks(jdRows(), target).some(w => !hasPrescribedWork(w))).toBe(false)
    }
  })

  it('sorts by plan_week regardless of array order', () => {
    const shuffled = [...jdRows()].reverse()
    const aligned = alignTemplateWeeks(shuffled, 3)
    expect(aligned.map(w => w.Q1)).toEqual([
      'Q1 for plan_week 15',
      'Q1 for plan_week 16',
      'Q1 for plan_week 17',
    ])
  })

  it('does not mutate its input', () => {
    const rows = jdRows()
    alignTemplateWeeks(rows, 5)
    expect(rows.map(w => w.plan_week)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1))
  })

  it('returns [] for an empty schedule or a non-positive target', () => {
    expect(alignTemplateWeeks([], 10)).toEqual([])
    expect(alignTemplateWeeks(jdRows(), 0)).toEqual([])
  })
})

describe('alignTemplateWeeksForPlan', () => {
  it('reserves the final plan week for the race', () => {
    // 15-week plan → 14 prescribed weeks; week 15 comes from race_week guidance.
    const aligned = alignTemplateWeeksForPlan(JD_TEMPLATE, 15)
    expect(aligned).toHaveLength(14)
    expect(aligned[7].Q1).toBe('Q1 for plan_week 11')  // plan week 8 → template plan_week 11
  })

  it('returns [] for templates without prescribed per-week rows', () => {
    const pfitz = {
      weekly_schedule: [{ week: 1, tuesday: 'Easy 8km', weekly_total: { km: 68 } }],
    } as unknown as FullTemplate
    expect(alignTemplateWeeksForPlan(pfitz, 15)).toEqual([])
    expect(hasPrescribedPerWeekRows(pfitz)).toBe(false)
  })

  it('reserves a race week from a content-free final row even without race_week guidance', () => {
    const noGuidance = { ...JD_TEMPLATE, race_week: undefined } as unknown as FullTemplate
    expect(alignTemplateWeeksForPlan(noGuidance, 15)).toHaveLength(14)
  })
})

describe('source_plan_week', () => {
  it('records the number each row was authored as', () => {
    const aligned = alignTemplateWeeks(jdRows(), 14)
    expect(aligned.map(w => w.source_plan_week)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17])
  })

  it('keeps the authored number through a second alignment pass', () => {
    const once = alignTemplateWeeks(jdRows(), 14)   // source_plan_week 4..17
    const twice = alignTemplateWeeks(once, 10)      // its last 10 → 8..17
    expect(twice.map(w => w.source_plan_week)).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17])
    expect(twice.map(w => w.plan_week)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })
})
