import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ParsedProgram } from '../schemas'

vi.mock('@/lib/agent/factory', () => ({ createLLMProvider: vi.fn() }))
vi.mock('@/lib/agent/llm-logger', () => ({ writeLLMLog: vi.fn() }))

import { createLLMProvider } from '@/lib/agent/factory'
import {
  generateCandidateDates,
  expandSessionsForScheduling,
  placeSessionsWithLLM,
  SchedulingFailedError,
} from '../scheduler'

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
