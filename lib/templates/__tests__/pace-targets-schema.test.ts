import { describe, it, expect } from 'vitest'
import { paceTargetSchema, paceTargetsSchema, REFERENCE_PACE_KEYS } from '../types'

describe('paceTargetSchema', () => {
  it('accepts a valid target with only required fields', () => {
    const result = paceTargetSchema.safeParse({
      reference_pace: 'easy',
      description: 'Easy conversational pace',
    })
    expect(result.success).toBe(true)
  })

  it('accepts walk as a valid reference_pace', () => {
    const result = paceTargetSchema.safeParse({
      reference_pace: 'walk',
      description: 'Brisk walking pace',
      prescription: 'time',
    })
    expect(result.success).toBe(true)
  })

  it('accepts negative offset_sec_per_km (faster than reference)', () => {
    const result = paceTargetSchema.safeParse({
      reference_pace: 'marathon',
      offset_sec_per_km: -6,
      description: '~10 sec/mile faster than marathon pace',
    })
    expect(result.success).toBe(true)
  })

  it('accepts a range target with reference_pace_upper', () => {
    const result = paceTargetSchema.safeParse({
      reference_pace: 'race_15k',
      reference_pace_upper: 'race_half_marathon',
      description: '15K to half marathon race pace',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an invalid reference_pace ("race_half" — common typo)', () => {
    const result = paceTargetSchema.safeParse({
      reference_pace: 'race_half',
      description: 'Half marathon pace',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const message = result.error.issues.map(i => i.message).join('; ')
      expect(message.toLowerCase()).toContain('race_half')
    }
  })

  it('rejects an invalid prescription value', () => {
    const result = paceTargetSchema.safeParse({
      reference_pace: 'easy',
      description: 'Easy pace',
      prescription: 'kilometres',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a missing reference_pace', () => {
    const result = paceTargetSchema.safeParse({
      description: 'No pace specified',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const paths = result.error.issues.map(i => i.path.join('.'))
      expect(paths).toContain('reference_pace')
    }
  })

  it('rejects a missing description', () => {
    const result = paceTargetSchema.safeParse({
      reference_pace: 'easy',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const paths = result.error.issues.map(i => i.path.join('.'))
      expect(paths).toContain('description')
    }
  })

  it('rejects an empty description', () => {
    const result = paceTargetSchema.safeParse({
      reference_pace: 'easy',
      description: '',
    })
    expect(result.success).toBe(false)
  })
})

describe('paceTargetsSchema', () => {
  it('accepts an empty pace_targets object', () => {
    const result = paceTargetsSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('accepts a fully populated Pfitzinger-style pace_targets', () => {
    const targets = {
      easy: { reference_pace: 'easy', description: 'Conversational pace' },
      lactate_threshold: {
        reference_pace: 'race_15k',
        reference_pace_upper: 'race_half_marathon',
        description: '15K to half marathon race pace',
      },
      vo2max: { reference_pace: 'race_5k', description: '5K race pace' },
      strides: { reference_pace: 'race_mile', description: 'Mile race pace' },
    }
    const result = paceTargetsSchema.safeParse(targets)
    expect(result.success).toBe(true)
  })

  it('reports the offending key when one entry is invalid', () => {
    const targets = {
      easy: { reference_pace: 'easy', description: 'Easy' },
      bad: { reference_pace: 'threshold', description: 'Threshold' }, // not canonical
    }
    const result = paceTargetsSchema.safeParse(targets)
    expect(result.success).toBe(false)
    if (!result.success) {
      const paths = result.error.issues.map(i => i.path.join('.'))
      expect(paths.some(p => p.startsWith('bad'))).toBe(true)
    }
  })
})

describe('REFERENCE_PACE_KEYS', () => {
  it('contains exactly the canonical 12 keys (5 training + 6 race + walk)', () => {
    expect(REFERENCE_PACE_KEYS).toEqual([
      'easy', 'marathon', 'tempo', 'interval', 'repetition', 'walk',
      'race_mile', 'race_3k', 'race_5k', 'race_10k', 'race_15k', 'race_half_marathon',
    ])
  })
})
