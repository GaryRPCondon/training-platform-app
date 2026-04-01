import { describe, it, expect } from 'vitest'
import { calculateRacePaces } from '../vdot'

describe('calculateRacePaces', () => {
  it('returns all 6 race pace fields', () => {
    const paces = calculateRacePaces(50)
    expect(paces).toHaveProperty('race_mile')
    expect(paces).toHaveProperty('race_3k')
    expect(paces).toHaveProperty('race_5k')
    expect(paces).toHaveProperty('race_10k')
    expect(paces).toHaveProperty('race_15k')
    expect(paces).toHaveProperty('race_half_marathon')
  })

  it('returns integer seconds/km values', () => {
    const paces = calculateRacePaces(50)
    for (const val of Object.values(paces)) {
      expect(Number.isInteger(val)).toBe(true)
    }
  })

  it('race paces increase with distance (shorter = faster)', () => {
    const paces = calculateRacePaces(50)
    expect(paces.race_mile).toBeLessThan(paces.race_3k)
    expect(paces.race_3k).toBeLessThan(paces.race_5k)
    expect(paces.race_5k).toBeLessThan(paces.race_10k)
    expect(paces.race_10k).toBeLessThan(paces.race_15k)
    expect(paces.race_15k).toBeLessThan(paces.race_half_marathon)
  })

  it('VDOT 50: 5K pace is ~4:00-4:10/km range', () => {
    // VDOT 50 ≈ 20:00 5K → 4:00/km (240 sec/km)
    const paces = calculateRacePaces(50)
    expect(paces.race_5k).toBeGreaterThanOrEqual(235)
    expect(paces.race_5k).toBeLessThanOrEqual(250)
  })

  it('VDOT 50: 10K pace is ~4:05-4:15/km range', () => {
    const paces = calculateRacePaces(50)
    expect(paces.race_10k).toBeGreaterThanOrEqual(245)
    expect(paces.race_10k).toBeLessThanOrEqual(255)
  })

  it('VDOT 50: half marathon pace is ~4:15-4:25/km range', () => {
    const paces = calculateRacePaces(50)
    expect(paces.race_half_marathon).toBeGreaterThanOrEqual(255)
    expect(paces.race_half_marathon).toBeLessThanOrEqual(268)
  })

  it('higher VDOT = faster paces', () => {
    const paces40 = calculateRacePaces(40)
    const paces60 = calculateRacePaces(60)
    expect(paces60.race_5k).toBeLessThan(paces40.race_5k)
    expect(paces60.race_10k).toBeLessThan(paces40.race_10k)
    expect(paces60.race_half_marathon).toBeLessThan(paces40.race_half_marathon)
  })
})
