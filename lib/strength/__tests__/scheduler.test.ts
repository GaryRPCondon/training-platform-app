import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ParsedProgram } from '../schemas'

vi.mock('@/lib/agent/factory', () => ({ createLLMProvider: vi.fn() }))
vi.mock('@/lib/agent/llm-logger', () => ({ writeLLMLog: vi.fn() }))

import { createLLMProvider } from '@/lib/agent/factory'
import {
  generateCandidateDates,
  expandSessionsForScheduling,
  placeSessionsWithLLM,
  placeStrengthSessionsWeekAware,
  hasWeekStructure,
  SchedulingFailedError,
} from '../scheduler'
import type { ParsedSession, LoadCategory } from '../schemas'

const mockedCreateProvider = vi.mocked(createLLMProvider)

function mockToolCall(placements: Array<{ session_index: number; scheduled_date: string; placement_rationale: string }>) {
  mockedCreateProvider.mockReturnValue({
    generateResponse: vi.fn().mockResolvedValue({
      content: '',
      model: 'mock-model',
      usage: { inputTokens: 100, outputTokens: 50 },
      toolCalls: [{
        id: 'tc-1',
        name: 'place_strength_sessions',
        arguments: { placements },
      }],
    }),
  } as unknown as ReturnType<typeof createLLMProvider>)
}

function mockNoToolCall() {
  mockedCreateProvider.mockReturnValue({
    generateResponse: vi.fn().mockResolvedValue({
      content: 'I refuse to use the tool.',
      model: 'mock-model',
      usage: { inputTokens: 50, outputTokens: 10 },
      toolCalls: [],
    }),
  } as unknown as ReturnType<typeof createLLMProvider>)
}

const makeProgram = (sessionCount: number): ParsedProgram => ({
  schema_version: '1.0',
  content_type: 'strength',
  name: 'Test',
  sessions: Array.from({ length: sessionCount }, (_, i) => ({
    session_index: i + 1,
    title: `Day ${i + 1}`,
    exercises: [{
      canonical_name: 'pushup',
      display_name: 'Push-up',
      user_text: '10 pushups',
      measurement: { type: 'reps', sets: 1, reps_per_set: 10 },
      garmin_supported: true,
    }],
  })),
})

describe('generateCandidateDates (fixed)', () => {
  it('produces one date per template session spaced ~3 days apart', () => {
    expect(generateCandidateDates('2026-06-01', 'fixed', 4)).toEqual([
      '2026-06-01', '2026-06-04', '2026-06-07', '2026-06-10',
    ])
  })

  it('handles a single-session fixed program', () => {
    expect(generateCandidateDates('2026-06-01', 'fixed', 1)).toEqual(['2026-06-01'])
  })

  it('handles month boundaries', () => {
    expect(generateCandidateDates('2026-05-30', 'fixed', 2)).toEqual([
      '2026-05-30', '2026-06-02',
    ])
  })

  it('returns an empty array for zero sessions', () => {
    expect(generateCandidateDates('2026-06-01', 'fixed', 0)).toEqual([])
  })
})

describe('generateCandidateDates (weekly)', () => {
  it('replicates the per-week candidates × weeksToRepeat', () => {
    // 2 sessions/week × 2 weeks = 4 dates; intra-week spacing = floor(7/2) = 3
    expect(generateCandidateDates('2026-06-01', 'weekly', 2, 2)).toEqual([
      '2026-06-01', '2026-06-04',           // week 1
      '2026-06-08', '2026-06-11',           // week 2
    ])
  })

  it('handles 3 sessions/week (Mon/Wed/Fri spacing)', () => {
    // intra-week spacing = floor(7/3) = 2
    expect(generateCandidateDates('2026-06-01', 'weekly', 3, 2)).toEqual([
      '2026-06-01', '2026-06-03', '2026-06-05',
      '2026-06-08', '2026-06-10', '2026-06-12',
    ])
  })

  it('throws when weeksToRepeat is missing for weekly mode', () => {
    expect(() => generateCandidateDates('2026-06-01', 'weekly', 2)).toThrow()
  })
})

describe('expandSessionsForScheduling', () => {
  it('passes through unchanged for fixed mode', () => {
    const expanded = expandSessionsForScheduling(makeProgram(3).sessions, 'fixed')
    expect(expanded).toHaveLength(3)
    expect(expanded.map(s => s.session_index)).toEqual([1, 2, 3])
  })

  it('replicates sessions × weeks with monotonically increasing indices', () => {
    const expanded = expandSessionsForScheduling(makeProgram(2).sessions, 'weekly', 3)
    expect(expanded).toHaveLength(6)
    expect(expanded.map(s => s.session_index)).toEqual([1, 2, 3, 4, 5, 6])
    // Template title repeats — sessions 1 & 3 & 5 share the same template title.
    expect(expanded[0].title).toBe('Day 1')
    expect(expanded[2].title).toBe('Day 1')
    expect(expanded[4].title).toBe('Day 1')
    expect(expanded[1].title).toBe('Day 2')
  })

  it('throws if weeksToRepeat is missing for weekly mode', () => {
    expect(() => expandSessionsForScheduling(makeProgram(2).sessions, 'weekly')).toThrow()
  })
})

describe('placeSessionsWithLLM (fixed)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns LLM placements when they satisfy the constraints', async () => {
    mockToolCall([
      { session_index: 1, scheduled_date: '2026-06-01', placement_rationale: 'Rest day' },
      { session_index: 2, scheduled_date: '2026-06-04', placement_rationale: 'Easy day' },
    ])
    const result = await placeSessionsWithLLM({
      parsedProgram: makeProgram(2),
      startDate: '2026-06-01',
      programType: 'fixed',
      plannedWorkouts: [
        { scheduled_date: '2026-06-01', workout_type: 'rest', description: null },
        { scheduled_date: '2026-06-02', workout_type: 'easy_run', description: 'Easy 6k' },
      ],
    })
    expect(result).toHaveLength(2)
    expect(result[0].session_index).toBe(1)
    expect(result[0].placement_rationale).toContain('Rest')
  })

  it('throws SchedulingFailedError if LLM does not call the tool', async () => {
    mockNoToolCall()
    await expect(placeSessionsWithLLM({
      parsedProgram: makeProgram(1),
      startDate: '2026-06-01',
      programType: 'fixed',
      plannedWorkouts: [],
    })).rejects.toThrow(SchedulingFailedError)
  })

  it('rejects placement count mismatch', async () => {
    mockToolCall([
      { session_index: 1, scheduled_date: '2026-06-01', placement_rationale: 'r' },
    ])
    await expect(placeSessionsWithLLM({
      parsedProgram: makeProgram(2),
      startDate: '2026-06-01',
      programType: 'fixed',
      plannedWorkouts: [],
    })).rejects.toThrow(SchedulingFailedError)
  })

  it('rejects non-sequential session indices', async () => {
    mockToolCall([
      { session_index: 1, scheduled_date: '2026-06-01', placement_rationale: 'r' },
      { session_index: 3, scheduled_date: '2026-06-05', placement_rationale: 'r' },  // skipped 2
    ])
    await expect(placeSessionsWithLLM({
      parsedProgram: makeProgram(2),
      startDate: '2026-06-01',
      programType: 'fixed',
      plannedWorkouts: [],
    })).rejects.toThrow(SchedulingFailedError)
  })

  it('rejects placements outside the ±7-day window', async () => {
    mockToolCall([
      { session_index: 1, scheduled_date: '2026-06-01', placement_rationale: 'r' },
      // Candidate for session 2 in fixed mode at 3-day spacing is 2026-06-04;
      // window is candidates[0]-7 .. candidates[N-1]+7 = 2026-05-25..2026-06-11.
      { session_index: 2, scheduled_date: '2026-06-30', placement_rationale: 'r' },
    ])
    await expect(placeSessionsWithLLM({
      parsedProgram: makeProgram(2),
      startDate: '2026-06-01',
      programType: 'fixed',
      plannedWorkouts: [],
    })).rejects.toThrow(SchedulingFailedError)
  })

  it('rejects out-of-order placements (session N+1 before session N)', async () => {
    mockToolCall([
      { session_index: 1, scheduled_date: '2026-06-05', placement_rationale: 'r' },
      { session_index: 2, scheduled_date: '2026-06-02', placement_rationale: 'r' },
    ])
    await expect(placeSessionsWithLLM({
      parsedProgram: makeProgram(2),
      startDate: '2026-06-01',
      programType: 'fixed',
      plannedWorkouts: [],
    })).rejects.toThrow(SchedulingFailedError)
  })

  it('sorts placements by session_index even if LLM returns them out of order', async () => {
    mockToolCall([
      { session_index: 2, scheduled_date: '2026-06-04', placement_rationale: 'second' },
      { session_index: 1, scheduled_date: '2026-06-01', placement_rationale: 'first' },
    ])
    const result = await placeSessionsWithLLM({
      parsedProgram: makeProgram(2),
      startDate: '2026-06-01',
      programType: 'fixed',
      plannedWorkouts: [],
    })
    expect(result.map(p => p.session_index)).toEqual([1, 2])
    expect(result[0].placement_rationale).toBe('first')
  })

  it('handles past-dated start_date the same way as future dates', async () => {
    mockToolCall([
      { session_index: 1, scheduled_date: '2026-01-01', placement_rationale: 'past' },
    ])
    const result = await placeSessionsWithLLM({
      parsedProgram: makeProgram(1),
      startDate: '2026-01-01',
      programType: 'fixed',
      plannedWorkouts: [],
    })
    expect(result[0].scheduled_date).toBe('2026-01-01')
  })
})

describe('placeSessionsWithLLM (weekly)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('expects template_sessions × weeksToRepeat placements', async () => {
    // 2 template sessions × 3 weeks = 6 expected placements
    mockToolCall([
      { session_index: 1, scheduled_date: '2026-06-01', placement_rationale: 'r' },
      { session_index: 2, scheduled_date: '2026-06-04', placement_rationale: 'r' },
      { session_index: 3, scheduled_date: '2026-06-08', placement_rationale: 'r' },
      { session_index: 4, scheduled_date: '2026-06-11', placement_rationale: 'r' },
      { session_index: 5, scheduled_date: '2026-06-15', placement_rationale: 'r' },
      { session_index: 6, scheduled_date: '2026-06-18', placement_rationale: 'r' },
    ])
    const result = await placeSessionsWithLLM({
      parsedProgram: makeProgram(2),
      startDate: '2026-06-01',
      programType: 'weekly',
      weeksToRepeat: 3,
      plannedWorkouts: [],
    })
    expect(result).toHaveLength(6)
    expect(result.map(p => p.session_index)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('rejects placement count mismatch (LLM returned only one week)', async () => {
    mockToolCall([
      { session_index: 1, scheduled_date: '2026-06-01', placement_rationale: 'r' },
      { session_index: 2, scheduled_date: '2026-06-04', placement_rationale: 'r' },
    ])
    await expect(placeSessionsWithLLM({
      parsedProgram: makeProgram(2),
      startDate: '2026-06-01',
      programType: 'weekly',
      weeksToRepeat: 3,
      plannedWorkouts: [],
    })).rejects.toThrow(SchedulingFailedError)
  })
})

// ---------------------------------------------------------------------------
// Deterministic week- and load-aware placement
// ---------------------------------------------------------------------------

// Build a session carrying week/day/load structure. exercises are irrelevant
// to placement, so a single stub keeps the fixtures readable.
function mkSession(
  session_index: number,
  week_index: number,
  day_index: number,
  load_category: LoadCategory,
): ParsedSession {
  return {
    session_index,
    title: `Week ${week_index} / Day ${day_index}`,
    week_index,
    day_index,
    load_category,
    exercises: [{
      canonical_name: 'pushup',
      display_name: 'Push-up',
      user_text: '10 pushups',
      measurement: { type: 'reps', sets: 1, reps_per_set: 10 },
      garmin_supported: true,
    }],
  }
}

// Consecutive ISO dates — placement reasons about adjacency, so weeks must be
// real back-to-back days (not the 3-day-spaced candidate generator).
function consecutive(start: string, n: number): string[] {
  const [y, m, d] = start.split('-').map(Number)
  const base = Date.UTC(y, m - 1, d)
  return Array.from({ length: n }, (_, i) =>
    new Date(base + i * 86_400_000).toISOString().slice(0, 10),
  )
}

// A classic 7-day run week starting Mon: 2 quality, 1 long, 3 easy, Sunday
// rest. This is the dense shape from the user's real plan.
function runWeek(monday: string) {
  const d = consecutive(monday, 7) // Mon..Sun, consecutive
  return [
    { scheduled_date: d[0], workout_type: 'easy_run', description: 'Easy 13k' },   // Mon
    { scheduled_date: d[1], workout_type: 'intervals', description: 'Q1' },        // Tue (hard)
    { scheduled_date: d[2], workout_type: 'easy_run', description: 'Easy 9k' },    // Wed
    { scheduled_date: d[3], workout_type: 'tempo', description: 'Q2' },            // Thu (hard)
    { scheduled_date: d[4], workout_type: 'easy_run', description: 'Easy 10k' },   // Fri
    { scheduled_date: d[5], workout_type: 'long_run', description: 'Long 17k' },   // Sat (hard)
    { scheduled_date: d[6], workout_type: 'rest', description: null },             // Sun (rest)
  ]
}

describe('hasWeekStructure', () => {
  it('true only when every session carries week_index', () => {
    expect(hasWeekStructure([mkSession(1, 1, 1, 'loaded')])).toBe(true)
    expect(hasWeekStructure([{ ...mkSession(1, 1, 1, 'loaded'), week_index: undefined }])).toBe(false)
    expect(hasWeekStructure([])).toBe(false)
  })
})

describe('placeStrengthSessionsWeekAware', () => {
  it('puts the mobility session on the rest day and loaded sessions on easy days', () => {
    const sessions = [
      mkSession(1, 1, 1, 'loaded'),            // Day A
      mkSession(2, 1, 2, 'loaded'),            // Day B
      mkSession(3, 1, 3, 'mobility_recovery'), // Day C
    ]
    const placements = placeStrengthSessionsWeekAware(sessions, '2026-06-01', runWeek('2026-06-01'))

    const byIndex = new Map(placements.map(p => [p.session_index, p]))
    // Mobility → Sunday rest day.
    expect(byIndex.get(3)!.scheduled_date).toBe('2026-06-07')
    expect(byIndex.get(3)!.placement_rationale).toContain('rest day')
    // Loaded sessions land on easy run days (Mon/Wed/Fri), never on hard days.
    const hardDays = new Set(['2026-06-02', '2026-06-04', '2026-06-06'])
    for (const idx of [1, 2]) {
      expect(['2026-06-01', '2026-06-03', '2026-06-05']).toContain(byIndex.get(idx)!.scheduled_date)
      expect(hardDays.has(byIndex.get(idx)!.scheduled_date)).toBe(false)
    }
  })

  it('never schedules two strength sessions on the same day', () => {
    const sessions = [
      mkSession(1, 1, 1, 'loaded'),
      mkSession(2, 1, 2, 'loaded'),
      mkSession(3, 1, 3, 'mobility_recovery'),
    ]
    const placements = placeStrengthSessionsWeekAware(sessions, '2026-06-01', runWeek('2026-06-01'))
    const dates = placements.map(p => p.scheduled_date)
    expect(new Set(dates).size).toBe(dates.length)
  })

  it('anchors each week to its own 7-day window (no drift across weeks)', () => {
    const sessions = [
      mkSession(1, 1, 1, 'loaded'),
      mkSession(2, 1, 2, 'mobility_recovery'),
      mkSession(3, 2, 1, 'loaded'),
      mkSession(4, 2, 2, 'mobility_recovery'),
    ]
    const workouts = [...runWeek('2026-06-01'), ...runWeek('2026-06-08')]
    const placements = placeStrengthSessionsWeekAware(sessions, '2026-06-01', workouts)
    // Week 1 sessions fall in 2026-06-01..07; week 2 in 2026-06-08..14.
    const w1 = placements.filter(p => p.session_index <= 2)
    const w2 = placements.filter(p => p.session_index >= 3)
    for (const p of w1) expect(p.scheduled_date >= '2026-06-01' && p.scheduled_date <= '2026-06-07').toBe(true)
    for (const p of w2) expect(p.scheduled_date >= '2026-06-08' && p.scheduled_date <= '2026-06-14').toBe(true)
  })

  it('falls back to mobility on an easy day when the week has no rest day', () => {
    // 7-day week with no rest: Mon-Sun all easy except two hard days.
    const monday = '2026-06-01'
    const d = consecutive(monday, 7)
    const noRestWeek = d.map((date, n) => ({
      scheduled_date: date,
      workout_type: n === 1 || n === 5 ? 'tempo' : 'easy_run',
      description: null,
    }))
    const sessions = [
      mkSession(1, 1, 1, 'loaded'),
      mkSession(2, 1, 2, 'mobility_recovery'),
    ]
    const placements = placeStrengthSessionsWeekAware(sessions, monday, noRestWeek)
    const mob = placements.find(p => p.session_index === 2)!
    expect(mob.placement_rationale).toContain('easy day')
    // Not placed on a hard day.
    expect([d[1], d[5]]).not.toContain(mob.scheduled_date)
  })

  it('spaces sessions evenly through weeks with no running scheduled', () => {
    // No planned workouts at all → even spacing, day order preserved.
    const sessions = [
      mkSession(1, 1, 1, 'loaded'),
      mkSession(2, 1, 2, 'loaded'),
      mkSession(3, 1, 3, 'mobility_recovery'),
    ]
    const placements = placeStrengthSessionsWeekAware(sessions, '2026-06-01', [])
    // spacing = floor(7/3) = 2 → Mon/Wed/Fri, in day order.
    expect(placements.map(p => p.scheduled_date)).toEqual(['2026-06-01', '2026-06-03', '2026-06-05'])
    expect(placements.every(p => p.placement_rationale.includes('no runs scheduled'))).toBe(true)
  })

  it('2 sessions/week: loaded on an easy day, mobility on the rest day, no compromise', () => {
    const sessions = [
      mkSession(1, 1, 1, 'loaded'),
      mkSession(2, 1, 2, 'mobility_recovery'),
    ]
    const placements = placeStrengthSessionsWeekAware(sessions, '2026-06-01', runWeek('2026-06-01'))
    const byIndex = new Map(placements.map(p => [p.session_index, p]))
    // Loaded → an easy run day (Mon/Wed/Fri), never a hard day.
    expect(['2026-06-01', '2026-06-03', '2026-06-05']).toContain(byIndex.get(1)!.scheduled_date)
    // Mobility → Sunday rest.
    expect(byIndex.get(2)!.scheduled_date).toBe('2026-06-07')
  })

  it('5 sessions/week: fills rest+easy first, then degrades gracefully onto hard days', () => {
    // 3 loaded + 2 mobility into a dense week with only 4 non-hard days
    // (Mon/Wed/Fri easy + Sun rest). The 5th session must overflow.
    const sessions = [
      mkSession(1, 1, 1, 'loaded'),
      mkSession(2, 1, 2, 'loaded'),
      mkSession(3, 1, 3, 'loaded'),
      mkSession(4, 1, 4, 'mobility_recovery'),
      mkSession(5, 1, 5, 'mobility_recovery'),
    ]
    const placements = placeStrengthSessionsWeekAware(sessions, '2026-06-01', runWeek('2026-06-01'))
    // Every session placed on a distinct day.
    const dates = placements.map(p => p.scheduled_date)
    expect(new Set(dates).size).toBe(5)
    // The 4 non-hard days are all used before any hard day is touched.
    const nonHard = new Set(['2026-06-01', '2026-06-03', '2026-06-05', '2026-06-07'])
    const hard = new Set(['2026-06-02', '2026-06-04', '2026-06-06'])
    expect(dates.filter(d => nonHard.has(d)).length).toBe(4)
    // Exactly one session overflows onto a hard day, flagged to lift after the run.
    const onHard = placements.filter(p => hard.has(p.scheduled_date))
    expect(onHard).toHaveLength(1)
    expect(onHard[0].placement_rationale).toContain('after your run')
  })

  it('returns exactly one placement per session', () => {
    const sessions = [
      mkSession(1, 1, 1, 'loaded'),
      mkSession(2, 1, 2, 'loaded'),
      mkSession(3, 1, 3, 'mobility_recovery'),
      mkSession(4, 2, 1, 'loaded'),
    ]
    const workouts = [...runWeek('2026-06-01'), ...runWeek('2026-06-08')]
    const placements = placeStrengthSessionsWeekAware(sessions, '2026-06-01', workouts)
    expect(placements).toHaveLength(4)
    expect(new Set(placements.map(p => p.session_index)).size).toBe(4)
  })
})
