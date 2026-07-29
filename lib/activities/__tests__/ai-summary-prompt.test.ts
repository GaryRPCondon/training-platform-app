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
      expect(prompt).toContain('do NOT downgrade for it')
    }
  })

  it('keeps the evaluation rubric out of the summary prose for every tone', () => {
    // The ceiling rule is for judging, not for narrating: summaries were coming back
    // reporting the rule itself ("the overall pace was slower than the easy pace
    // ceiling, which aligns with the intent of an easy run").
    const tones: FeedbackTone[] = ['critical', 'balanced', 'positive']
    for (const tone of tones) {
      const prompt = buildSystemPrompt(tone)
      expect(prompt).toContain('internal reasoning, not material for the summary')
      expect(prompt).toContain('never report that something was within its bounds')
      expect(prompt).toContain('do not mention the easy pace at all unless the athlete actually ran faster than it')
      // Naming the words is the same priming that caused the bug — the rule has to
      // hold without a vocabulary blocklist to quote from.
      expect(prompt).not.toMatch(/never borrow its vocabulary/)
    }
  })

  it('does not force a shortfall onto a clean session in any tone', () => {
    // The balanced clause demanded "equal weight" praise and criticism, so a flawless
    // easy run got a manufactured second sentence ("some laps exceeded the easy pace
    // ceiling"). Every tone now has an explicit out.
    expect(buildSystemPrompt('balanced')).toContain('do not manufacture a shortfall')
    expect(buildSystemPrompt('balanced')).not.toContain('Equal weight to both')
    expect(buildSystemPrompt('positive')).toContain('omit them entirely when there are none')
    expect(buildSystemPrompt('critical')).toContain('do not invent criticism')
  })

  it('lets an easy run reach 5.0 without hitting a pace target', () => {
    // "5.0: Nailed it — distance, pace, intensity all on target" is unsatisfiable for a
    // run deliberately slower than easy pace, so the model hedged to 4.5.
    const prompt = buildSystemPrompt('balanced')
    expect(prompt).toContain('however far below it the pace sat')
    expect(prompt).not.toContain('5.0: Nailed it — distance, pace, intensity all on target')
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

  it('tells the LLM that only active laps are evaluated against the work-rep target', () => {
    const tones: FeedbackTone[] = ['critical', 'balanced', 'positive']
    for (const tone of tones) {
      const prompt = buildSystemPrompt(tone)
      expect(prompt).toContain('ONLY active work-rep laps')
      expect(prompt).toContain('Warmup, cooldown, and recovery laps')
      expect(prompt).toContain('MUST NOT be counted as misses')
    }
  })

  it('requires the summary to state pace direction (too fast / too slow / on target)', () => {
    const prompt = buildSystemPrompt('balanced')
    expect(prompt).toContain('too fast, too slow, or on target')
  })
})
