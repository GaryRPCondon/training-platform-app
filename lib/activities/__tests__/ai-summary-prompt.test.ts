import { describe, it, expect } from 'vitest'
import { buildSystemPrompt, type FeedbackTone } from '../ai-summary'

describe('buildSystemPrompt', () => {
  it('includes the run-type adherence weighting clause for every tone', () => {
    const tones: FeedbackTone[] = ['critical', 'balanced', 'positive']
    for (const tone of tones) {
      const prompt = buildSystemPrompt(tone)
      expect(prompt).toContain('Adherence weighting by run type')
      expect(prompt).toContain('Easy runs / recovery runs / long runs')
      expect(prompt).toContain('Intervals / tempo / threshold / VO2max')
      expect(prompt).toContain('do NOT downgrade it for lap-to-lap variance')
    }
  })

  it('embeds a critical-leaning clause when tone is critical', () => {
    const prompt = buildSystemPrompt('critical')
    expect(prompt).toContain('VOICE = CRITICAL')
    expect(prompt).toContain('unsparing')
  })

  it('embeds the balanced clause when tone is balanced (current production voice)', () => {
    const prompt = buildSystemPrompt('balanced')
    expect(prompt).toContain('VOICE = BALANCED')
  })

  it('embeds a positive-leaning clause when tone is positive', () => {
    const prompt = buildSystemPrompt('positive')
    expect(prompt).toContain('VOICE = POSITIVE')
    expect(prompt).toContain('Never flatter')
  })

  it('puts the tone clause near the top of the prompt (before the rules list)', () => {
    for (const tone of ['critical', 'balanced', 'positive'] as FeedbackTone[]) {
      const prompt = buildSystemPrompt(tone)
      const voiceIdx = prompt.indexOf('VOICE =')
      const rulesIdx = prompt.indexOf('Rules:')
      expect(voiceIdx).toBeGreaterThan(0)
      expect(voiceIdx).toBeLessThan(rulesIdx)
    }
  })

  it('keeps the JSON output contract identical across tones', () => {
    const tones: FeedbackTone[] = ['critical', 'balanced', 'positive']
    for (const tone of tones) {
      const prompt = buildSystemPrompt(tone)
      expect(prompt).toContain('"star_rating"')
      expect(prompt).toContain('"summary"')
      expect(prompt).toContain('respond ONLY with valid JSON')
    }
  })
})
