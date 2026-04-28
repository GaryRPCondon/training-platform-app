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
  validation_ranges: {
    easy_run: { min: 5000, max: 12000 },
    long_run: { min: 15000, max: 30000 },
    tempo: { min: 8000, max: 16000 },
    rest: { min: 0, max: 0 },
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
  race_week: {
    day_before_race: 'easy_shakeout',
    shakeout_distance_meters: 5000,
    volume_pct_of_peak: 50,
    guidance: 'Short easy shakeout the day before. No workouts after the race.',
  },
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

  it('matches snapshot for time-based template (run/walk)', () => {
    const timeBasedTemplate: FullTemplate = {
      ...TEST_TEMPLATE,
      template_id: 'nhs-c25k',
      name: 'NHS Couch to 5K',
      author: 'NHS',
      methodology: 'NHS',
      distance: '5k',
      duration_weeks: 9,
      training_days_per_week: 3,
      peak_weekly_mileage: { miles: 10, km: 16 },
      target_audience: {
        experience_level: 'complete_beginner',
        prerequisites: ['Can walk briskly for 5 minutes'],
      },
      philosophy: {
        approach: 'run_walk_progression',
        key_features: ['Run/walk intervals', 'No pace targets', 'Time-based'],
      },
      validation_ranges: { easy_run: { min: 800, max: 5000 } },
      weekly_schedule: [{
        week: 1,
        phase: 'Run/Walk Intervals',
        tuesday: '5 min warm-up walk, then alternate 1 min running / 1.5 min walking for 20 minutes',
      }],
    }
    const prompt = buildGenerationSystemPrompt({
      ...BASE_CONTEXT,
      template: timeBasedTemplate,
      criteria: { ...TEST_CRITERIA, goal_type: '5k', current_weekly_mileage: 0, comfortable_peak_mileage: 0, days_per_week: 3 },
      goal_type: '5k',
      isTimeBased: true,
    })
    expect(prompt).toMatchSnapshot()
  })

  it('includes duration_seconds instructions for time-based templates', () => {
    const prompt = buildGenerationSystemPrompt({
      ...BASE_CONTEXT,
      isTimeBased: true,
    })
    expect(prompt).toContain('duration_seconds')
    expect(prompt).toContain('TIME-BASED PRESCRIPTIONS')
    expect(prompt).not.toContain('DISTANCE-BASED PRESCRIPTIONS')
  })

  it('excludes duration_seconds for distance-based templates', () => {
    const prompt = buildGenerationSystemPrompt(BASE_CONTEXT)
    expect(prompt).toContain('DISTANCE-BASED PRESCRIPTIONS')
    expect(prompt).not.toContain('TIME-BASED PRESCRIPTIONS')
  })

  it('contains JSON output format instruction', () => {
    const prompt = buildGenerationSystemPrompt(BASE_CONTEXT)
    expect(prompt).toContain('weeks')
    expect(prompt).toContain('week_number')
  })

  it('renders RACE WEEK GUIDANCE block when template has race_week', () => {
    const prompt = buildGenerationSystemPrompt(BASE_CONTEXT)
    expect(prompt).toContain('RACE WEEK GUIDANCE')
    expect(prompt).toContain('easy_shakeout')
    expect(prompt).toContain('5000m shakeout')
    expect(prompt).toContain('50% of the peak training week')
    // When race_week is present, the blanket POST-RACE RULE is suppressed
    expect(prompt).not.toContain('POST-RACE RULE')
  })

  it('falls back to POST-RACE RULE when template lacks race_week', () => {
    const { race_week: _removed, ...templateWithoutRaceWeek } = TEST_TEMPLATE
    const prompt = buildGenerationSystemPrompt({
      ...BASE_CONTEXT,
      template: templateWithoutRaceWeek as FullTemplate,
    })
    expect(prompt).not.toContain('RACE WEEK GUIDANCE')
    expect(prompt).toContain('POST-RACE RULE')
  })

  it('renders PER-WEEK PRESCRIBED WORKOUTS block with per-day easy volumes when template has E_days_distribution', () => {
    const templateWithDistribution: FullTemplate = {
      ...TEST_TEMPLATE,
      weekly_schedule: [
        {
          week: 18,
          plan_week: 1,
          fraction_of_peak: 0.7,
          phase: 'base',
          Q1: '3E + 7M + 1T + 2M + 2E',
          Q1_mileage: 15,
          Q1_km: 24,
          Q1_type: 'long_run',
          Q2: '5E + 2T + 2 min rest + 2E',
          Q2_mileage: 13,
          Q2_km: 21,
          Q2_type: 'tempo',
          E_days_total: 21,
          total_km: 79,
          E_days_distribution: [
            { day: 'Monday', km: 10, mileage: 6, notes: 'Easy recovery' },
            { day: 'Tuesday', km: 8, mileage: 5, notes: 'Consider strides' },
            { day: 'Thursday', km: 8, mileage: 5, notes: 'Consider strides' },
            { day: 'Friday', km: 8, mileage: 5, notes: 'Consider strides' },
          ],
        },
      ],
    }
    const prompt = buildGenerationSystemPrompt({
      ...BASE_CONTEXT,
      template: templateWithDistribution,
    })
    expect(prompt).toContain('PER-WEEK PRESCRIBED WORKOUTS')
    expect(prompt).toContain('Week 1 (total 49 mi. (79 km), fraction of peak 0.7):')
    expect(prompt).toContain('- Q1 (long_run): 15 mi. (24 km) — "3E + 7M + 1T + 2M + 2E"')
    expect(prompt).toContain('- Q2 (tempo): 13 mi. (21 km) — "5E + 2T + 2 min rest + 2E"')
    expect(prompt).toContain('- Easy: 6 mi. (10 km) — Easy recovery')
    expect(prompt).toContain('- Easy: 5 mi. (8 km) — Consider strides')
    expect(prompt).toContain('- Rest')
    // The old aggregate-targets block must not be emitted when per-day is available.
    expect(prompt).not.toContain('PER-WEEK TARGETS (binding — from template):')
    expect(prompt).not.toContain('±10% of the template\'s total_km')
  })

  it('renders [SESSION, W/C: …] tags on Q-slots when is_session/warmup_cooldown are set', () => {
    const templateWithSessionTags: FullTemplate = {
      ...TEST_TEMPLATE,
      weekly_schedule: [
        {
          week: 18,
          plan_week: 1,
          fraction_of_peak: 0.7,
          phase: 'base',
          Q1: 'steady E run of 90-120 min',
          Q1_mileage: 12,
          Q1_km: 19,
          Q1_type: 'long_run',
          Q1_is_session: false,
          Q1_warmup_cooldown: 'included',
          Q2: '6 × (1T w/1 min jg) + 2E',
          Q2_mileage: 9,
          Q2_km: 14,
          Q2_type: 'tempo',
          Q2_is_session: true,
          Q2_warmup_cooldown: 'add',
          E_days_total: 14,
          total_km: 47,
          E_days_distribution: [
            { day: 'Monday', km: 8, mileage: 5, notes: 'Easy recovery' },
            { day: 'Tuesday', km: 6, mileage: 4, notes: 'Consider strides' },
          ],
        },
      ],
    }
    const prompt = buildGenerationSystemPrompt({
      ...BASE_CONTEXT,
      template: templateWithSessionTags,
    })
    // Q1 is non-session, has W/C: included → only [W/C: included] tag
    expect(prompt).toContain('- Q1 (long_run) [W/C: included]: 12 mi. (19 km) — "steady E run of 90-120 min"')
    // Q2 is session with W/C: add → both tags
    expect(prompt).toContain('- Q2 (tempo) [SESSION, W/C: add]: 9 mi. (14 km) — "6 × (1T w/1 min jg) + 2E"')
    // Header explains the tag semantics
    expect(prompt).toContain('[SESSION]')
    expect(prompt).toContain('[W/C: included]')
    expect(prompt).toContain('[W/C: add]')
  })

  it('falls back to aggregate PER-WEEK TARGETS when template has plan_week+total_km but no E_days_distribution', () => {
    const templateAggregateOnly: FullTemplate = {
      ...TEST_TEMPLATE,
      weekly_schedule: [
        {
          week: 18,
          plan_week: 1,
          total_km: 79,
          Q1_km: 24,
          Q2_km: 21,
          phase: 'base',
        },
      ],
    }
    const prompt = buildGenerationSystemPrompt({
      ...BASE_CONTEXT,
      template: templateAggregateOnly,
    })
    expect(prompt).toContain('PER-WEEK TARGETS (binding — from template):')
    expect(prompt).toContain('W1 | 79 | 24 | 21')
    expect(prompt).not.toContain('PER-WEEK PRESCRIBED WORKOUTS')
  })

  it('renders TIME-PRESCRIBED INTENSITIES block when a pace_target has prescription:time', () => {
    const templateWithTimePrescribed: FullTemplate = {
      ...TEST_TEMPLATE,
      pace_targets: {
        easy: { reference_pace: 'easy', description: 'Comfortable conversational pace' },
        walk: { reference_pace: 'walk', description: 'Brisk walking pace', prescription: 'time' },
      },
    }
    const prompt = buildGenerationSystemPrompt({
      ...BASE_CONTEXT,
      template: templateWithTimePrescribed,
    })
    expect(prompt).toContain('TIME-PRESCRIBED INTENSITIES (from template):')
    expect(prompt).toContain('"walk" — Brisk walking pace')
    expect(prompt).toContain('Do NOT convert these time-prescribed intensities to distance.')
  })

  it('does not render TIME-PRESCRIBED INTENSITIES block when no pace_target has prescription:time', () => {
    const prompt = buildGenerationSystemPrompt(BASE_CONTEXT)
    expect(prompt).not.toContain('TIME-PRESCRIBED INTENSITIES (from template)')
  })

  it('does not render TIME-PRESCRIBED INTENSITIES block for whole-template time-based plans', () => {
    const templateWithTimePrescribed: FullTemplate = {
      ...TEST_TEMPLATE,
      pace_targets: {
        walk: { reference_pace: 'walk', description: 'Brisk walking pace', prescription: 'time' },
      },
    }
    const prompt = buildGenerationSystemPrompt({
      ...BASE_CONTEXT,
      template: templateWithTimePrescribed,
      isTimeBased: true,
    })
    expect(prompt).not.toContain('TIME-PRESCRIBED INTENSITIES (from template)')
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
