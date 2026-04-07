import { describe, it, expect } from 'vitest'
import {
  buildGenerationSystemPrompt,
  buildGenerationUserMessage,
  estimateGenerationTokens,
  type GenerationContext,
} from '../llm-prompts'
import type { FullTemplate, UserCriteria } from '@/lib/templates/types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_TEMPLATE: FullTemplate = {
  template_id: 'pfitz-18-55',
  name: 'Pfitzinger 18/55',
  author: 'Pete Pfitzinger',
  methodology: 'pfitzinger',
  distance: 'marathon',
  duration_weeks: 18,
  training_days_per_week: 5,
  peak_weekly_mileage: { miles: 55, km: 88 },
  target_audience: {
    experience_level: 'intermediate',
    prerequisites: ['Comfortable running 35+ miles/week'],
  },
  philosophy: {
    approach: 'high_mileage',
    key_features: ['Lactate threshold runs', 'Medium-long runs', 'Recovery runs'],
  },
  weekly_schedule: [
    {
      week: 1,
      phase: 'base',
      monday: 'Rest',
      tuesday: 'Easy 8km',
      wednesday: 'Medium-long 14km',
      thursday: 'Lactate threshold 10km',
      friday: 'Recovery 6km',
      saturday: 'Long run 22km',
      sunday: 'Easy 8km',
      weekly_total: { km: 68 },
    },
  ],
}

const TEST_CRITERIA: UserCriteria = {
  goal_type: 'marathon',
  experience_level: 'intermediate',
  current_weekly_mileage: 50,
  comfortable_peak_mileage: 88,
  days_per_week: 5,
  weeks_available: 18,
}

const BASE_CONTEXT: GenerationContext = {
  template: TEST_TEMPLATE,
  criteria: TEST_CRITERIA,
  goal_date: '2026-10-11',     // Fixed date for stable snapshots
  start_date: '2026-06-15',    // Monday start
  goal_type: 'marathon',
  first_day_of_week: 1,        // Monday
  preferred_units: 'metric',
}

// ---------------------------------------------------------------------------
// Snapshot tests
// ---------------------------------------------------------------------------

describe('buildGenerationSystemPrompt', () => {
  it('matches snapshot for standard metric plan (Monday start)', () => {
    const prompt = buildGenerationSystemPrompt(BASE_CONTEXT)
    expect(prompt).toMatchSnapshot()
  })

  it('matches snapshot for imperial plan (Sunday start)', () => {
    const prompt = buildGenerationSystemPrompt({
      ...BASE_CONTEXT,
      start_date: '2026-06-14',  // Sunday
      first_day_of_week: 0,
      preferred_units: 'imperial',
    })
    expect(prompt).toMatchSnapshot()
  })

  it('includes partial pre-week section when start date is mid-week', () => {
    // Wednesday start → 5 partial days before next Monday
    const prompt = buildGenerationSystemPrompt({
      ...BASE_CONTEXT,
      start_date: '2026-06-17', // Wednesday
    })
    expect(prompt).toContain('Pre-Week')
    expect(prompt).toContain('pre_week_workouts')
  })

  it('does not include pre-week section when start is on plan start day', () => {
    // Start on Monday → 0 partial days
    const prompt = buildGenerationSystemPrompt({
      ...BASE_CONTEXT,
      start_date: '2026-06-15', // Monday
    })
    expect(prompt).not.toContain('pre_week_workouts')
  })

  it('contains template name in prompt', () => {
    const prompt = buildGenerationSystemPrompt(BASE_CONTEXT)
    expect(prompt).toContain('Pfitzinger 18/55')
  })

  it('contains race date in prompt', () => {
    const prompt = buildGenerationSystemPrompt(BASE_CONTEXT)
    expect(prompt).toContain('2026')
  })

  it('contains workout_index format instruction (W#:D#)', () => {
    const prompt = buildGenerationSystemPrompt(BASE_CONTEXT)
    expect(prompt).toMatch(/W\d+:D\d+/)
  })

  it('contains consecutive hard workout prohibition', () => {
    const prompt = buildGenerationSystemPrompt(BASE_CONTEXT)
    expect(prompt.toLowerCase()).toContain('consecutive')
  })

  it('contains JSON output format instruction', () => {
    const prompt = buildGenerationSystemPrompt(BASE_CONTEXT)
    expect(prompt).toContain('weeks')
    expect(prompt).toContain('week_number')
  })
})

describe('buildGenerationUserMessage', () => {
  it('contains template JSON in user message', () => {
    const message = buildGenerationUserMessage(TEST_TEMPLATE)
    expect(message).toContain('pfitz-18-55')
    expect(message).toContain('Pfitzinger')
  })

  it('is a non-empty string', () => {
    const message = buildGenerationUserMessage(TEST_TEMPLATE)
    expect(typeof message).toBe('string')
    expect(message.length).toBeGreaterThan(0)
  })
})

describe('estimateGenerationTokens', () => {
  it('returns a positive number', () => {
    const tokens = estimateGenerationTokens(BASE_CONTEXT)
    expect(tokens).toBeGreaterThan(0)
  })

  it('estimates roughly chars/4', () => {
    const prompt = buildGenerationSystemPrompt(BASE_CONTEXT)
    const message = buildGenerationUserMessage(BASE_CONTEXT.template)
    const totalChars = prompt.length + message.length
    const estimated = estimateGenerationTokens(BASE_CONTEXT)
    // Should be within 20% of chars/4
    expect(estimated).toBeGreaterThan(totalChars / 4 * 0.8)
    expect(estimated).toBeLessThan(totalChars / 4 * 1.2)
  })
})
