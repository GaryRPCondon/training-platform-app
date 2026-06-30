import { describe, it, expect } from 'vitest'
import {
  buildImportedGenerationSystemPrompt,
  buildImportedGenerationUserMessage,
} from '@/lib/plans/import/generation-prompts'
import type { ParsedRunningPlan } from '@/lib/plans/import/schemas'

const definition: ParsedRunningPlan = {
  schema_version: '1.0',
  name: 'Pfitzinger 18/55',
  distance: 'marathon',
  weeks: [
    { week_index: 1, phase: 'base', workouts: [{ day_of_week: 1, type: 'easy_run', description: 'Easy 8 km', distance_meters: 8000, intensity: 'easy' }] },
    { week_index: 2, phase: 'base', workouts: [{ day_of_week: 6, type: 'long_run', description: 'Long 24 km', distance_meters: 24000, intensity: 'easy' }] },
  ],
  parse_warnings: [],
}

const ctx = {
  definition,
  criteria: { current_weekly_mileage: 40, comfortable_peak_mileage: 65, days_per_week: 5, preferred_rest_days: [1] },
  goal_date: '2026-05-03',
  start_date: '2026-01-05',
  goal_type: 'marathon' as const,
  first_day_of_week: 1 as const,
  preferred_units: 'metric' as const,
}

describe('buildImportedGenerationSystemPrompt', () => {
  it('frames the imported plan as the source and includes the athlete constraints', () => {
    const p = buildImportedGenerationSystemPrompt(ctx)
    expect(p).toContain('SOURCE PLAN: Pfitzinger 18/55')
    expect(p).toContain('Current weekly mileage: 40km')
    expect(p).toContain('Maximum comfortable weekly mileage: 65km')
    expect(p).toContain('Training days per week: 5')
    // preferred rest day Monday surfaced
    expect(p).toContain('Monday')
  })

  it('embeds the shared output contract (kept in sync with the template path)', () => {
    const p = buildImportedGenerationSystemPrompt(ctx)
    expect(p).toContain('OUTPUT FORMAT')
    expect(p).toContain('WORKOUT TYPES')
    expect(p).toContain('STRUCTURED WORKOUT')
    expect(p).toContain('ROLE FIELD ON INTERVALS')
    expect(p).toContain('CRITICAL WORKOUT SCHEDULING RULE')
  })

  it('does not ask for experience level (template-matching only)', () => {
    const p = buildImportedGenerationSystemPrompt(ctx)
    expect(p).not.toMatch(/experience level/i)
  })
})

describe('buildImportedGenerationUserMessage', () => {
  it('serialises the full definition for the model to adapt', () => {
    const m = buildImportedGenerationUserMessage(definition)
    expect(m).toContain('Pfitzinger 18/55')
    expect(m).toContain('"week_index": 1')
    expect(m).toContain('Long 24 km')
  })
})
