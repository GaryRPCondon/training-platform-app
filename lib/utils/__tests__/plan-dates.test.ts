import { describe, it, expect } from 'vitest'
import { computeWeeksAvailable } from '../plan-dates'

describe('computeWeeksAvailable', () => {
  it('returns 10 for a 70-day Mon→Sun span (10 calendar weeks)', () => {
    // 2026-05-04 (Mon) → 2026-07-12 (Sun) = 69 days, +1 partial = 10 weeks.
    // The original off-by-one returned 9 here; this regression-tests the fix.
    expect(computeWeeksAvailable('2026-05-04', '2026-07-12')).toBe(10)
  })

  it('returns 10 for a 69-day Mon→Sat span', () => {
    // 2026-05-04 (Mon) → 2026-07-11 (Sat) = 68 days, +1 partial = 10 weeks
    expect(computeWeeksAvailable('2026-05-04', '2026-07-11')).toBe(10)
  })

  it('returns 9 for a 63-day Mon→Sun span (9 calendar weeks)', () => {
    // 2026-05-04 (Mon) → 2026-07-05 (Sun) = 62 days, +1 partial = 9 weeks
    expect(computeWeeksAvailable('2026-05-04', '2026-07-05')).toBe(9)
  })

  it('returns 2 for a 7-day Mon→Mon span (1 training week + race week)', () => {
    expect(computeWeeksAvailable('2026-05-04', '2026-05-11')).toBe(2)
  })

  it('returns 1 for a 1-day span (minimum viable)', () => {
    expect(computeWeeksAvailable('2026-05-04', '2026-05-05')).toBe(1)
  })

  it('returns 1 for same-day (degenerate but does not crash)', () => {
    expect(computeWeeksAvailable('2026-05-04', '2026-05-04')).toBe(1)
  })

  it('clamps to 1 when goal is before start (defensive)', () => {
    expect(computeWeeksAvailable('2026-05-10', '2026-05-04')).toBe(1)
  })

  it('accepts Date objects as well as strings', () => {
    const start = new Date('2026-05-04')
    const goal = new Date('2026-07-12')
    expect(computeWeeksAvailable(start, goal)).toBe(10)
  })
})
