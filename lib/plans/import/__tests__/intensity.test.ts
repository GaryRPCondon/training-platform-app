import { describe, it, expect } from 'vitest'
import {
  intensityToPaceKey,
  mapTextToIntensity,
  normalizeIntensity,
  RUN_INTENSITIES,
} from '../intensity'

describe('intensityToPaceKey', () => {
  it('collapses every canonical intensity onto a VDOT pace key', () => {
    for (const intensity of RUN_INTENSITIES) {
      const key = intensityToPaceKey(intensity)
      expect(['easy', 'marathon', 'tempo', 'interval', 'repetition']).toContain(key)
    }
  })

  it('maps the obvious families correctly', () => {
    expect(intensityToPaceKey('recovery')).toBe('easy')
    expect(intensityToPaceKey('long')).toBe('easy')
    expect(intensityToPaceKey('marathon_pace')).toBe('marathon')
    expect(intensityToPaceKey('race')).toBe('marathon')
    expect(intensityToPaceKey('threshold')).toBe('tempo')
    expect(intensityToPaceKey('vo2max')).toBe('interval')
    expect(intensityToPaceKey('rep')).toBe('repetition')
    expect(intensityToPaceKey('strides')).toBe('repetition')
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
