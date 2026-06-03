import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { StrengthExerciseCatalog } from '@/types/database'

vi.mock('@/lib/agent/factory', () => ({
  createLLMProvider: vi.fn(),
}))
vi.mock('@/lib/agent/llm-logger', () => ({
  writeLLMLog: vi.fn(),
}))

import { createLLMProvider } from '@/lib/agent/factory'
import { parseStrengthProgram, ParseFailedError } from '../parser'

const mockedCreateProvider = vi.mocked(createLLMProvider)

const catalog: StrengthExerciseCatalog[] = [
  {
    id: 1, canonical_name: 'pushup', display_name: 'Push-up',
    aliases: ['press-up', 'press up'], measurement_type: 'reps',
    garmin_exercise_category: 'CHEST', garmin_exercise_name: 'PUSH_UP',
    garmin_step_type: 'STRENGTH', garmin_supported: true,
    created_at: '2026-05-19T00:00:00Z',
  },
  {
    id: 2, canonical_name: 'plank', display_name: 'Plank',
    aliases: [], measurement_type: 'duration',
    garmin_exercise_category: 'PLANK', garmin_exercise_name: 'PLANK',
    garmin_step_type: 'STRENGTH', garmin_supported: false,
    created_at: '2026-05-19T00:00:00Z',
  },
]

function mockLLM(content: string, opts?: { model?: string }) {
  mockedCreateProvider.mockReturnValue({
    generateResponse: vi.fn().mockResolvedValue({
      content,
      model: opts?.model ?? 'mock-model',
      usage: { inputTokens: 100, outputTokens: 200 },
    }),
  } as unknown as ReturnType<typeof createLLMProvider>)
}

const validParserOutput = {
  program: {
    schema_version: '1.0',
    content_type: 'strength',
    name: 'Test Program',
    sessions: [
      {
        session_index: 1,
        title: 'Day 1',
        exercises: [
          {
            canonical_name: 'pushup',
            display_name: 'Push-up',
            user_text: '15 pushups',
            measurement: { type: 'reps', sets: 1, reps_per_set: 15 },
            garmin_supported: false,
          },
          {
            canonical_name: 'plank',
            display_name: 'Plank',
            user_text: '1 minute plank',
            measurement: { type: 'duration', sets: 1, duration_seconds: 60 },
            garmin_supported: false,
          },
        ],
      },
    ],
  },
  confidence: 0.9,
  content_type: 'strength',
  warnings: [],
}

describe('parseStrengthProgram', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a validated ParsedProgram for a clean LLM response', async () => {
    mockLLM(JSON.stringify(validParserOutput))
    const result = await parseStrengthProgram({
      text: 'Day 1: 15 pushups, 1 minute plank',
      source_format: 'free_text',
      catalog,
    })
    expect(result.program.sessions).toHaveLength(1)
    expect(result.program.sessions[0].exercises).toHaveLength(2)
    expect(result.confidence).toBe(0.9)
    expect(result.contentType).toBe('strength')
  })

  it('strips ```json code fences before parsing', async () => {
    mockLLM('```json\n' + JSON.stringify(validParserOutput) + '\n```')
    const result = await parseStrengthProgram({
      text: 'Day 1: 15 pushups',
      source_format: 'free_text',
      catalog,
    })
    expect(result.program.name).toBe('Test Program')
  })

  it('overrides LLM garmin_supported with catalog truth (supported exercise)', async () => {
    // LLM emits garmin_supported: false (per the system prompt rule).
    // Catalog says pushup is supported. Mapper must flip it to true.
    mockLLM(JSON.stringify(validParserOutput))
    const result = await parseStrengthProgram({
      text: 'x',
      source_format: 'free_text',
      catalog,
    })
    const pushup = result.program.sessions[0].exercises[0]
    expect(pushup.canonical_name).toBe('pushup')
    expect(pushup.garmin_supported).toBe(true)
    expect(pushup.garmin_unsupported_reason).toBeUndefined()
  })

  it('keeps garmin_supported false for catalog rows without Garmin IDs', async () => {
    mockLLM(JSON.stringify(validParserOutput))
    const result = await parseStrengthProgram({
      text: 'x',
      source_format: 'free_text',
      catalog,
    })
    const plank = result.program.sessions[0].exercises[1]
    expect(plank.canonical_name).toBe('plank')
    expect(plank.garmin_supported).toBe(false)
    expect(plank.garmin_unsupported_reason).toBe('Catalog entry missing Garmin IDs')
  })

  it('marks unknown exercises as unsupported with "not in catalog" reason', async () => {
    const withUnknown = {
      ...validParserOutput,
      program: {
        ...validParserOutput.program,
        sessions: [{
          session_index: 1,
          title: 'Day 1',
          exercises: [{
            canonical_name: 'nordic_curl',
            display_name: 'Nordic Curl',
            user_text: 'nordic curl x 5',
            measurement: { type: 'reps', sets: 1, reps_per_set: 5 },
            garmin_supported: false,
          }],
        }],
      },
    }
    mockLLM(JSON.stringify(withUnknown))
    const result = await parseStrengthProgram({
      text: 'x',
      source_format: 'free_text',
      catalog,
    })
    const ex = result.program.sessions[0].exercises[0]
    expect(ex.garmin_supported).toBe(false)
    expect(ex.garmin_unsupported_reason).toBe('Exercise not in catalog')
  })

  it('re-sequences session_index to 1..N even when the LLM duplicates or skips one', async () => {
    const dupIndices = {
      ...validParserOutput,
      program: {
        ...validParserOutput.program,
        sessions: [
          { session_index: 1, title: 'A', exercises: validParserOutput.program.sessions[0].exercises },
          { session_index: 17, title: 'B', exercises: validParserOutput.program.sessions[0].exercises },
          { session_index: 17, title: 'C', exercises: validParserOutput.program.sessions[0].exercises },
        ],
      },
    }
    mockLLM(JSON.stringify(dupIndices))
    const result = await parseStrengthProgram({ text: 'x', source_format: 'free_text', catalog })
    expect(result.program.sessions.map(s => s.session_index)).toEqual([1, 2, 3])
    // Order is preserved (titles stay in emit order).
    expect(result.program.sessions.map(s => s.title)).toEqual(['A', 'B', 'C'])
  })

  it('throws ParseFailedError on invalid JSON', async () => {
    mockLLM('this is not json {{{')
    await expect(parseStrengthProgram({
      text: 'x',
      source_format: 'free_text',
      catalog,
    })).rejects.toThrow(ParseFailedError)
  })

  it('throws ParseFailedError on schema mismatch', async () => {
    mockLLM(JSON.stringify({ program: { name: 'Missing required fields' } }))
    await expect(parseStrengthProgram({
      text: 'x',
      source_format: 'free_text',
      catalog,
    })).rejects.toThrow(ParseFailedError)
  })

  it('surfaces low confidence + "other" content_type when input is not a strength plan', async () => {
    const refusal = {
      ...validParserOutput,
      confidence: 0.1,
      content_type: 'other',
      warnings: ['Input appears to be a running plan, not a strength program.'],
    }
    mockLLM(JSON.stringify(refusal))
    const result = await parseStrengthProgram({
      text: 'Marathon week 1: Easy 8km / Tempo 6km / Long 20km',
      source_format: 'free_text',
      catalog,
    })
    expect(result.confidence).toBeLessThan(0.5)
    expect(result.contentType).toBe('other')
    expect(result.warnings).toHaveLength(1)
  })
})
