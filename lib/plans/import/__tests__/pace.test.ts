import { describe, it, expect } from 'vitest'
import { parsePaceLiteral, resolveImportPace } from '../pace'
import type { AllTrainingPaces } from '@/lib/training/vdot'

const paces: AllTrainingPaces = {
  easy: 330,
  marathon: 300,
  tempo: 280,
  interval: 255,
  repetition: 240,
  walk: 600,
}

describe('parsePaceLiteral', () => {
  it('parses per-km clock paces', () => {
    expect(parsePaceLiteral('4:30/km')).toBe(270)
    expect(parsePaceLiteral('4:30 km')).toBe(270)
    expect(parsePaceLiteral('5:00')).toBe(300)
  })

  it('converts per-mile to per-km', () => {
    // 7:15/mi = 435 s/mi -> /1.60934 ~= 270 s/km
    expect(parsePaceLiteral('7:15/mi')).toBe(270)
    expect(parsePaceLiteral('7:15 per mile')).toBe(270)
  })

  it('rejects malformed input', () => {
    expect(parsePaceLiteral(null)).toBeNull()
    expect(parsePaceLiteral('')).toBeNull()
    expect(parsePaceLiteral('fast')).toBeNull()
    expect(parsePaceLiteral('4:70/km')).toBeNull() // seconds >= 60
    expect(parsePaceLiteral('4:30:00')).toBeNull() // not mm:ss
  })
})

describe('resolveImportPace', () => {
  it('prefers a literal pace over VDOT', () => {
    const r = resolveImportPace('easy', '4:00/km', paces)
    expect(r).toEqual({ target_pace_sec_per_km: 240, pace_label: 'easy', pace_source: 'literal' })
  })

  it('falls back to VDOT via intensity->pace key', () => {
    expect(resolveImportPace('vo2max', null, paces)).toEqual({
      target_pace_sec_per_km: 255,
      pace_label: 'vo2max',
      pace_source: 'vdot',
    })
    expect(resolveImportPace('marathon_pace', null, paces)?.target_pace_sec_per_km).toBe(300)
    expect(resolveImportPace('recovery', null, paces)?.target_pace_sec_per_km).toBe(330)
  })

  it('returns null when no literal and no athlete paces', () => {
    expect(resolveImportPace('threshold', null, null)).toBeNull()
    expect(resolveImportPace(null, null, paces)).toBeNull()
  })

  it('uses literal even without athlete paces', () => {
    expect(resolveImportPace(null, '3:45/km', null)?.target_pace_sec_per_km).toBe(225)
  })
})
