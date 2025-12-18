import { describe, it, expect } from 'vitest'
import {
  calculateVDOT,
  calculateTrainingPaces,
  formatPace,
  formatTime,
  parseRaceTime
} from '../vdot'

describe('VDOT Calculations', () => {
  it('calculates VDOT from 10K in 40:00', () => {
    const vdot = calculateVDOT(40 * 60, 10000)
    expect(vdot).toBeCloseTo(51.5, 0)
  })

  it('calculates VDOT from marathon in 3:30:00', () => {
    const vdot = calculateVDOT(3.5 * 3600, 42195)
    expect(vdot).toBeCloseTo(45.5, 0)
  })

  it('calculates training paces for VDOT 50', () => {
    const paces = calculateTrainingPaces(50)

    // Rough expected ranges (seconds/km)
    expect(paces.easy).toBeGreaterThan(300) // Slower than 5:00/km
    expect(paces.easy).toBeLessThan(360) // Faster than 6:00/km

    expect(paces.marathon).toBeGreaterThan(240) // Slower than 4:00/km
    expect(paces.marathon).toBeLessThan(300) // Faster than 5:00/km

    expect(paces.tempo).toBeLessThan(paces.marathon) // Tempo faster than marathon
    expect(paces.interval).toBeLessThan(paces.tempo) // Interval faster than tempo
  })
})

describe('Time Parsing & Formatting', () => {
  it('parses MM:SS format', () => {
    expect(parseRaceTime('40:00')).toBe(2400)
    expect(parseRaceTime('21:30')).toBe(1290)
  })

  it('parses HH:MM:SS format', () => {
    expect(parseRaceTime('3:30:00')).toBe(12600)
    expect(parseRaceTime('1:35:24')).toBe(5724)
  })

  it('formats pace correctly', () => {
    expect(formatPace(330)).toBe('5:30/km')
    expect(formatPace(285)).toBe('4:45/km')
  })

  it('formats time correctly', () => {
    expect(formatTime(2400)).toBe('40:00')
    expect(formatTime(12600)).toBe('3:30:00')
  })
})
