import { describe, it, expect } from 'vitest'
import {
  intensityToPaceKey,
  mapTextToIntensity,
  normalizeIntensity,
  RUN_INTENSITIES,
} from '../intensity'

describe('intensityToPaceKey', () => {
  // Pins the whole vocabulary. This function now delegates to the shared resolver in
  // lib/training/vdot.ts instead of owning an exhaustive switch, so this table is what
  // guarantees an import token can't silently start resolving to a different pace.
  const EXPECTED: Record<(typeof RUN_INTENSITIES)[number], string> = {
    recovery: 'recovery',
    easy: 'easy',
    long: 'easy',
    marathon_pace: 'marathon',
    race: 'marathon',
    threshold: 'tempo',
    vo2max: 'interval',
    rep: 'repetition',
    strides: 'repetition',
  }

  it('maps every canonical intensity to its VDOT pace key', () => {
    for (const intensity of RUN_INTENSITIES) {
      expect(intensityToPaceKey(intensity)).toBe(EXPECTED[intensity])
    }
  })

  it('keeps recovery distinct from easy', () => {
    expect(intensityToPaceKey('recovery')).toBe('recovery')
    expect(intensityToPaceKey('easy')).toBe('easy')
  })
})

describe('mapTextToIntensity', () => {
  it.each([
    ['general aerobic', 'easy'],
    ['Easy 8 km', 'easy'],
    ['recovery jog', 'recovery'],
    ['Long run', 'long'],
    ['marathon race pace', 'marathon_pace'],
    ['15K to half marathon race pace', 'threshold'],
    ['Lactate threshold', 'threshold'],
    ['tempo', 'threshold'],
    ['VO2max', 'vo2max'],
    ['5K race pace', 'vo2max'],
    ['3K pace reps', 'rep'],
    ['6 x 100 m strides', 'strides'],
  ])('maps %j -> %j', (input, expected) => {
    expect(mapTextToIntensity(input)).toBe(expected)
  })

  it('returns null when it cannot classify', () => {
    expect(mapTextToIntensity('do something fun')).toBeNull()
    expect(mapTextToIntensity('')).toBeNull()
  })

  it('prefers strides over marathon when both words appear', () => {
    expect(mapTextToIntensity('marathon-pace strides')).toBe('strides')
  })
})

describe('normalizeIntensity', () => {
  it('passes through canonical tokens unchanged', () => {
    expect(normalizeIntensity('vo2max')).toBe('vo2max')
    expect(normalizeIntensity('  threshold ')).toBe('threshold')
  })

  it('maps aliases / free text', () => {
    expect(normalizeIntensity('general aerobic')).toBe('easy')
  })

  it('returns null for null/undefined/unclassifiable', () => {
    expect(normalizeIntensity(null)).toBeNull()
    expect(normalizeIntensity(undefined)).toBeNull()
    expect(normalizeIntensity('xyzzy')).toBeNull()
  })
})
