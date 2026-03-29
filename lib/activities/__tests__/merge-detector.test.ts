import { describe, it, expect } from 'vitest'
import { findMergeCandidates, shouldAutoMerge, type Activity } from '../merge-detector'

function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 1,
    start_time: '2026-03-25T08:00:00Z',
    duration_seconds: 3600,
    distance_meters: 10000,
    source: 'garmin',
    garmin_id: null,
    strava_id: null,
    ...overrides,
  }
}

describe('findMergeCandidates', () => {
  it('returns null for empty existing activities', () => {
    expect(findMergeCandidates(makeActivity(), [])).toBeNull()
  })

  it('skips activities from the same source', () => {
    const newActivity = makeActivity({ source: 'garmin' })
    const existing = makeActivity({ source: 'garmin' })
    expect(findMergeCandidates(newActivity, [existing])).toBeNull()
  })

  it('skips already-merged activities (both garmin_id and strava_id populated)', () => {
    const newActivity = makeActivity({ source: 'garmin', garmin_id: 'g1' })
    const existing = makeActivity({ source: 'strava', garmin_id: 'existing-g', strava_id: 'existing-s' })
    expect(findMergeCandidates(newActivity, [existing])).toBeNull()
  })

  it('returns high confidence for near-identical activities from different sources', () => {
    const newActivity = makeActivity({ source: 'garmin' })
    const existing = makeActivity({ source: 'strava' })
    const candidate = findMergeCandidates(newActivity, [existing])
    expect(candidate).not.toBeNull()
    expect(candidate!.confidence).toBe('high')
    expect(candidate!.confidenceScore).toBeGreaterThanOrEqual(90)
  })

  it('returns high confidence for 0.3% distance difference', () => {
    // distanceDiff=0.3%, score = 100 - 0.3*20 = 94 → high (score>=90, distanceDiff<=0.5)
    const newActivity = makeActivity({ source: 'garmin', distance_meters: 10030 })
    const existing = makeActivity({ source: 'strava', distance_meters: 10000 })
    const candidate = findMergeCandidates(newActivity, [existing])
    expect(candidate).not.toBeNull()
    expect(candidate!.confidence).toBe('high')
    expect(candidate!.distanceDiffPercent).toBeCloseTo(0.3, 1)
  })

  it('returns medium confidence for 1.5% distance difference', () => {
    // distanceDiff=1.5%, score = 100 - 1.5*20 = 70 → medium (score>=70, distanceDiff<=2)
    const newActivity = makeActivity({ source: 'garmin', distance_meters: 10150 })
    const existing = makeActivity({ source: 'strava', distance_meters: 10000 })
    const candidate = findMergeCandidates(newActivity, [existing])
    expect(candidate).not.toBeNull()
    expect(candidate!.confidence).toBe('medium')
  })

  it('returns low confidence for 2.5% distance difference', () => {
    // distanceDiff=2.5%, score = 100 - 2.5*20 = 50 → low (score>=50 but not medium)
    const newActivity = makeActivity({ source: 'garmin', distance_meters: 10250 })
    const existing = makeActivity({ source: 'strava', distance_meters: 10000 })
    const candidate = findMergeCandidates(newActivity, [existing])
    expect(candidate).not.toBeNull()
    expect(candidate!.confidence).toBe('low')
  })

  it('returns null for 3% distance difference (score below threshold)', () => {
    // distanceDiff=3%, score = 100 - 3*20 = 40 < 50 → no match
    const newActivity = makeActivity({ source: 'garmin', distance_meters: 10300 })
    const existing = makeActivity({ source: 'strava', distance_meters: 10000 })
    expect(findMergeCandidates(newActivity, [existing])).toBeNull()
  })

  it('returns null for 10% distance difference', () => {
    const newActivity = makeActivity({ source: 'garmin', distance_meters: 11000 })
    const existing = makeActivity({ source: 'strava', distance_meters: 10000 })
    expect(findMergeCandidates(newActivity, [existing])).toBeNull()
  })

  it('handles zero-distance activities (yoga, weight training) with perfect distance match', () => {
    const newActivity = makeActivity({ source: 'garmin', distance_meters: 0, duration_seconds: 3600 })
    const existing = makeActivity({ source: 'strava', distance_meters: 0, duration_seconds: 3600 })
    const candidate = findMergeCandidates(newActivity, [existing])
    expect(candidate).not.toBeNull()
    expect(candidate!.confidence).toBe('high')
    expect(candidate!.distanceDiffPercent).toBe(0)
  })

  it('matches date-only activity (midnight timestamp) within 24-hour window', () => {
    // Strava date-only import at midnight; Garmin has precise time 8.5 hours later
    const newActivity = makeActivity({
      source: 'strava',
      start_time: '2026-03-25T00:00:00Z',
      distance_meters: 10000,
    })
    const existing = makeActivity({
      source: 'garmin',
      start_time: '2026-03-25T08:30:00Z',
      distance_meters: 10000,
    })
    expect(findMergeCandidates(newActivity, [existing])).not.toBeNull()
  })

  it('rejects date-only activities more than 24 hours apart', () => {
    const newActivity = makeActivity({
      source: 'strava',
      start_time: '2026-03-25T00:00:00Z',
      distance_meters: 10000,
    })
    const existing = makeActivity({
      source: 'garmin',
      start_time: '2026-03-26T08:00:00Z', // 32 hours later
      distance_meters: 10000,
    })
    expect(findMergeCandidates(newActivity, [existing])).toBeNull()
  })

  it('timezone offset: 3-hour difference with near-perfect distance/duration → high confidence', () => {
    // 3h = 180 min, isLikelyTimezoneOffset=true (180 % 60 === 0 && <= 720)
    // distanceDiff=0.01% < 0.2%, durationDiff≈0.03% < 0.5% → isNearPerfectMatch=true
    // score = 100 - min(180*0.01, 5) - 0.01*20 - 0.03*10 ≈ 97.6 → high
    const newActivity = makeActivity({
      source: 'garmin',
      start_time: '2026-03-25T05:00:00Z',
      distance_meters: 10001,
      duration_seconds: 3601,
    })
    const existing = makeActivity({
      source: 'strava',
      start_time: '2026-03-25T08:00:00Z',
      distance_meters: 10000,
      duration_seconds: 3600,
    })
    const candidate = findMergeCandidates(newActivity, [existing])
    expect(candidate).not.toBeNull()
    expect(candidate!.confidence).toBe('high')
  })

  it('returns first candidate in list order', () => {
    const newActivity = makeActivity({ source: 'garmin' })
    const first = makeActivity({ id: 10, source: 'strava' })
    const second = makeActivity({ id: 20, source: 'strava', start_time: '2026-03-25T08:01:00Z' })
    const candidate = findMergeCandidates(newActivity, [first, second])
    expect(candidate!.activity2).toBe(first)
  })
})

describe('shouldAutoMerge', () => {
  it('returns true for high confidence candidate', () => {
    const candidate = findMergeCandidates(makeActivity({ source: 'garmin' }), [makeActivity({ source: 'strava' })])!
    expect(shouldAutoMerge(candidate)).toBe(true)
  })

  it('returns false for medium confidence candidate', () => {
    // 1.5% distance diff → medium
    const candidate = findMergeCandidates(
      makeActivity({ source: 'garmin', distance_meters: 10150 }),
      [makeActivity({ source: 'strava', distance_meters: 10000 })]
    )!
    expect(candidate.confidence).toBe('medium')
    expect(shouldAutoMerge(candidate)).toBe(false)
  })

  it('returns false for low confidence candidate', () => {
    // 2.5% distance diff → low
    const candidate = findMergeCandidates(
      makeActivity({ source: 'garmin', distance_meters: 10250 }),
      [makeActivity({ source: 'strava', distance_meters: 10000 })]
    )!
    expect(candidate.confidence).toBe('low')
    expect(shouldAutoMerge(candidate)).toBe(false)
  })
})
