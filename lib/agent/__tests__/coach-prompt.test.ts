import { describe, it, expect } from 'vitest'
import { buildCoachSystemPrompt } from '../coach-prompt'
import type { CoachContext } from '../coach-context-loader'
import type { ResolvedPace } from '@/lib/plans/pace-resolver'

const baseContext: CoachContext = {
  athlete: {
    id: 'athlete-1',
    name: 'Test Runner',
    preferred_units: 'metric',
    vdot: 53,
    training_paces: null,
    week_starts_on: 1,
  },
  plan: null,
  currentPhase: null,
  thisWeek: null,
  phaseExecution: null,
  upcomingWeeks: [],
  constraints: [],
  recentFeedback: [],
  personalRecords: {},
  recentActivities: [],
  strengthPrograms: [],
  strengthSessions: [],
  methodologyPaces: null,
}

const METHODOLOGY: Record<string, ResolvedPace> = {
  E: { target_pace_sec_per_km: 300, target_pace_upper_sec_per_km: null, pace_label: 'E', pace_description: 'Easy aerobic', pace_source: 'template' },
  R10: { target_pace_sec_per_km: 237, target_pace_upper_sec_per_km: null, pace_label: 'R10', pace_description: '1km rep pace', pace_source: 'template' },
}

describe('buildCoachSystemPrompt — methodology paces', () => {
  it('renders the Plan Pace Targets section with labels, paces and descriptions', () => {
    const prompt = buildCoachSystemPrompt({ ...baseContext, methodologyPaces: METHODOLOGY })
    expect(prompt).toContain('## Plan Pace Targets (methodology labels)')
    expect(prompt).toContain('- E: 5:00/km — Easy aerobic')
    expect(prompt).toContain('- R10: 3:57/km — 1km rep pace')
  })

  it('instructs the coach to use the exact labels for intensity_target', () => {
    const prompt = buildCoachSystemPrompt({ ...baseContext, methodologyPaces: METHODOLOGY })
    expect(prompt).toMatch(/EXACT labels for `intensity_target`/)
    // tool-instructions section names the available labels
    expect(prompt).toContain("methodology labels (E, R10)")
  })

  it('omits the section entirely when there are no methodology paces', () => {
    const prompt = buildCoachSystemPrompt(baseContext)
    expect(prompt).not.toContain('## Plan Pace Targets')
  })

  it('renders a pace range when an upper bound is present', () => {
    const ranged: Record<string, ResolvedPace> = {
      T: { target_pace_sec_per_km: 245, target_pace_upper_sec_per_km: 250, pace_label: 'T', pace_description: 'Threshold', pace_source: 'template' },
    }
    const prompt = buildCoachSystemPrompt({ ...baseContext, methodologyPaces: ranged })
    expect(prompt).toContain('- T: 4:05–4:10/km — Threshold')
  })
})
