import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ParsedProgram } from '../schemas'

vi.mock('@/lib/agent/factory', () => ({ createLLMProvider: vi.fn() }))
vi.mock('@/lib/agent/llm-logger', () => ({ writeLLMLog: vi.fn() }))

import { createLLMProvider } from '@/lib/agent/factory'
import {
  generateCandidateDates,
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

describe('generateCandidateDates', () => {
  it('produces N evenly-spaced dates starting at start_date', () => {
    expect(generateCandidateDates('2026-06-01', 2, 4)).toEqual([
      '2026-06-01', '2026-06-03', '2026-06-05', '2026-06-07',
    ])
  })

  it('handles cadence_days=1 (daily) correctly', () => {
    expect(generateCandidateDates('2026-06-01', 1, 3)).toEqual([
      '2026-06-01', '2026-06-02', '2026-06-03',
    ])
  })

  it('handles month boundaries', () => {
    expect(generateCandidateDates('2026-05-30', 2, 3)).toEqual([
      '2026-05-30', '2026-06-01', '2026-06-03',
    ])
  })

  it('handles year boundaries', () => {
    expect(generateCandidateDates('2025-12-30', 3, 3)).toEqual([
      '2025-12-30', '2026-01-02', '2026-01-05',
    ])
  })

  it('returns an empty array for zero sessions', () => {
    expect(generateCandidateDates('2026-06-01', 2, 0)).toEqual([])
  })

  it('throws for cadence_days < 1', () => {
    expect(() => generateCandidateDates('2026-06-01', 0, 1)).toThrow()
  })
})

describe('placeSessionsWithLLM', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns LLM placements when they satisfy the constraints', async () => {
    mockToolCall([
      { session_index: 1, scheduled_date: '2026-06-01', placement_rationale: 'Rest day' },
      { session_index: 2, scheduled_date: '2026-06-03', placement_rationale: 'Easy day' },
    ])
    const result = await placeSessionsWithLLM({
      parsedProgram: makeProgram(2),
      startDate: '2026-06-01',
      cadenceDays: 2,
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
      cadenceDays: 2,
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
      cadenceDays: 2,
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
      cadenceDays: 2,
      plannedWorkouts: [],
    })).rejects.toThrow(SchedulingFailedError)
  })

  it('rejects placements outside the ±7-day window', async () => {
    mockToolCall([
      { session_index: 1, scheduled_date: '2026-06-01', placement_rationale: 'r' },
      // Candidate for session 2 is 2026-06-03; window end is 2026-06-10.
      { session_index: 2, scheduled_date: '2026-06-30', placement_rationale: 'r' },
    ])
    await expect(placeSessionsWithLLM({
      parsedProgram: makeProgram(2),
      startDate: '2026-06-01',
      cadenceDays: 2,
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
      cadenceDays: 2,
      plannedWorkouts: [],
    })).rejects.toThrow(SchedulingFailedError)
  })

  it('sorts placements by session_index even if LLM returns them out of order', async () => {
    mockToolCall([
      { session_index: 2, scheduled_date: '2026-06-03', placement_rationale: 'second' },
      { session_index: 1, scheduled_date: '2026-06-01', placement_rationale: 'first' },
    ])
    const result = await placeSessionsWithLLM({
      parsedProgram: makeProgram(2),
      startDate: '2026-06-01',
      cadenceDays: 2,
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
      cadenceDays: 2,
      plannedWorkouts: [],
    })
    expect(result[0].scheduled_date).toBe('2026-01-01')
  })
})
