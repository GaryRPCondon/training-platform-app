import { describe, it, expect } from 'vitest'
import { resolvePace, resolveAllPaces, formatPaceMinKm, formatResolvedPace, type PaceTarget } from '../pace-resolver'
import type { AllTrainingPaces } from '@/lib/training/vdot'

// VDOT ~50 athlete paces (seconds/km)
const ATHLETE_PACES: AllTrainingPaces = {
  easy: 330,          // 5:30/km
  recovery: 356,      // 5:56/km
  marathon: 275,      // 4:35/km
  tempo: 253,         // 4:13/km
  interval: 224,      // 3:44/km
  repetition: 210,    // 3:30/km
  walk: 600,
  race_mile: 205,
  race_3k: 218,
  race_5k: 240,
  race_10k: 255,
  race_15k: 262,
  race_half_marathon: 272,
}

const HANSONS_TARGETS = {
  easy:     { reference_pace: 'easy', description: 'Conversational pace' },
  strength: { reference_pace: 'marathon', offset_sec_per_km: -6, description: '~10 sec/mile faster than marathon pace' },
  tempo:    { reference_pace: 'marathon', description: 'Marathon goal pace' },
  speed:    { reference_pace: 'interval', description: '5K-10K race pace' },
} as const satisfies Record<string, PaceTarget>

const PFITZ_TARGETS = {
  lactate_threshold: { reference_pace: 'race_15k', reference_pace_upper: 'race_half_marathon', description: '15K to half marathon race pace' },
  vo2max: { reference_pace: 'race_5k', description: '5K race pace' },
  strides: { reference_pace: 'race_mile', description: 'Approximately mile race pace' },
} as const satisfies Record<string, PaceTarget>

describe('resolvePace', () => {
  it('returns null when label not found in targets and is not a base pace', () => {
    expect(resolvePace('unknown', HANSONS_TARGETS, ATHLETE_PACES)).toBeNull()
    expect(resolvePace('unknown', undefined, ATHLETE_PACES)).toBeNull()
  })

  it('returns null when intensity is empty', () => {
    expect(resolvePace('', HANSONS_TARGETS, ATHLETE_PACES)).toBeNull()
  })

  // A label naming a base VDOT pace resolves with or without a template. This is what
  // lets the coach prescribe `recovery` on a plan whose methodology never declared it.
  it('resolves a base pace key with no template targets at all', () => {
    const result = resolvePace('recovery', undefined, ATHLETE_PACES)!
    expect(result.target_pace_sec_per_km).toBe(356)
    expect(result.target_pace_upper_sec_per_km).toBeNull()
    expect(result.pace_label).toBe('recovery')
    expect(resolvePace('easy', undefined, ATHLETE_PACES)!.target_pace_sec_per_km).toBe(330)
  })

  it('resolves a base pace key a template omitted', () => {
    const targetsWithoutRecovery = { easy: HANSONS_TARGETS.easy }
    expect(resolvePace('recovery', targetsWithoutRecovery, ATHLETE_PACES)!.target_pace_sec_per_km).toBe(356)
  })

  // Methodology intent wins: Hansons runs recovery at easy + 15 s, not at the base
  // recovery pace, and a template that declares the label must keep that offset.
  it('prefers a template recovery target over the base recovery pace', () => {
    const targets = {
      ...HANSONS_TARGETS,
      recovery: { reference_pace: 'easy', offset_sec_per_km: 15, description: 'Very easy' },
    } as Record<string, PaceTarget>
    const result = resolvePace('recovery', targets, ATHLETE_PACES)!
    expect(result.target_pace_sec_per_km).toBe(345)
    expect(result.pace_description).toBe('Very easy')
  })

  it('never resolves walk off the base paces — a walk step gets no target', () => {
    expect(resolvePace('walk', undefined, ATHLETE_PACES)).toBeNull()
  })

  it('resolves Hansons easy to athlete easy pace', () => {
    const result = resolvePace('easy', HANSONS_TARGETS, ATHLETE_PACES)!
    expect(result.target_pace_sec_per_km).toBe(330)
    expect(result.target_pace_upper_sec_per_km).toBeNull()
    expect(result.pace_label).toBe('easy')
    expect(result.pace_source).toBe('template')
  })

  it('resolves Hansons strength with negative offset', () => {
    const result = resolvePace('strength', HANSONS_TARGETS, ATHLETE_PACES)!
    // marathon(275) + offset(-6) = 269
    expect(result.target_pace_sec_per_km).toBe(269)
    expect(result.pace_label).toBe('strength')
    expect(result.pace_description).toContain('10 sec/mile faster')
  })

  it('resolves Hansons tempo to marathon pace (no offset)', () => {
    const result = resolvePace('tempo', HANSONS_TARGETS, ATHLETE_PACES)!
    expect(result.target_pace_sec_per_km).toBe(275)
  })

  it('resolves Pfitz LT as a range (race_15k → race_half_marathon)', () => {
    const result = resolvePace('lactate_threshold', PFITZ_TARGETS, ATHLETE_PACES)!
    expect(result.target_pace_sec_per_km).toBe(262) // race_15k
    expect(result.target_pace_upper_sec_per_km).toBe(272) // race_half_marathon
  })

  it('resolves Pfitz VO2max to race_5k', () => {
    const result = resolvePace('vo2max', PFITZ_TARGETS, ATHLETE_PACES)!
    expect(result.target_pace_sec_per_km).toBe(240)
  })

  it('resolves Pfitz strides to race_mile', () => {
    const result = resolvePace('strides', PFITZ_TARGETS, ATHLETE_PACES)!
    expect(result.target_pace_sec_per_km).toBe(205)
  })

  it('returns null when referenced pace key does not exist on athlete', () => {
    const partialPaces = { easy: 330, marathon: 275, tempo: 253, interval: 224, repetition: 210 }
    const result = resolvePace('vo2max', PFITZ_TARGETS, partialPaces as AllTrainingPaces)
    expect(result).toBeNull()
  })
})

describe('resolveAllPaces', () => {
  it('resolves all Hansons targets', () => {
    const all = resolveAllPaces(HANSONS_TARGETS, ATHLETE_PACES)
    expect(Object.keys(all)).toEqual(['easy', 'strength', 'tempo', 'speed'])
    expect(all.strength.target_pace_sec_per_km).toBe(269)
  })

  it('returns empty object when paceTargets is undefined', () => {
    expect(resolveAllPaces(undefined, ATHLETE_PACES)).toEqual({})
  })
})

describe('formatPaceMinKm', () => {
  it('formats 330 as 5:30', () => {
    expect(formatPaceMinKm(330)).toBe('5:30')
  })

  it('formats 253 as 4:13', () => {
    expect(formatPaceMinKm(253)).toBe('4:13')
  })

  it('pads single-digit seconds', () => {
    expect(formatPaceMinKm(303)).toBe('5:03')
  })
})

describe('formatResolvedPace', () => {
  it('formats single pace', () => {
    const resolved = resolvePace('easy', HANSONS_TARGETS, ATHLETE_PACES)!
    expect(formatResolvedPace(resolved)).toBe('5:30/km')
  })

  it('formats range pace', () => {
    const resolved = resolvePace('lactate_threshold', PFITZ_TARGETS, ATHLETE_PACES)!
    expect(formatResolvedPace(resolved)).toBe('4:22-4:32/km')
  })

  it('formats imperial pace', () => {
    const resolved = resolvePace('easy', HANSONS_TARGETS, ATHLETE_PACES)!
    const formatted = formatResolvedPace(resolved, 'imperial')
    // 330 * 1.60934 ≈ 531 sec/mi → 8:51
    expect(formatted).toContain('/mi')
  })
})
