import { describe, it, expect } from 'vitest'
import { matchActivities } from '../../activity-matcher'
import type { Activity } from '@/types/database'

function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 1,
    athlete_id: 'athlete-1',
    garmin_id: null,
    strava_id: null,
    source: 'garmin',
    activity_name: null,
    activity_type: 'running',
    start_time: '2026-03-25T08:00:00.000Z',
    distance_meters: 10000,
    duration_seconds: 3600,
    moving_duration_seconds: null,
    elevation_gain_meters: null,
    elevation_loss_meters: null,
    avg_hr: null,
    max_hr: null,
    min_hr: null,
    avg_power: null,
    max_power: null,
    normalized_power: null,
    avg_cadence: null,
    max_cadence: null,
    calories: null,
    perceived_effort: null,
    notes: null,
    planned_workout_id: null,
    garmin_data: null,
    strava_data: null,
    synced_from_garmin: null,
    synced_from_strava: null,
    hr_zones: null,
    has_detail_data: null,
    match_confidence: null,
    match_method: null,
    ...overrides,
  } as Activity
}

describe('matchActivities', () => {
  it('returns status none for empty existing activities', () => {
    const result = matchActivities(makeActivity(), [])
    expect(result.status).toBe('none')
    expect(result.matchFound).toBe(false)
  })

  it('returns auto_merged for exact match (score=100)', () => {
    const newActivity = makeActivity()
    const existing = makeActivity({ id: 2 })
    const result = matchActivities(newActivity, [existing])
    expect(result.status).toBe('auto_merged')
    expect(result.matchFound).toBe(true)
    expect(result.confidenceScore).toBe(100)
    expect(result.matchedActivityId).toBe(2)
  })

  it('returns auto_merged for score >= 98 (same time, tiny duration diff)', () => {
    // 0 time diff, 0.5% duration diff → score = 100 - 0.5 = 99.5 → auto_merged
    const newActivity = makeActivity({ duration_seconds: 3600 })
    const existing = makeActivity({ id: 2, duration_seconds: 3582 }) // ~0.5% diff
    const result = matchActivities(newActivity, [existing])
    expect(result.status).toBe('auto_merged')
  })

  it('returns pending_review for score 91-97', () => {
    // 2 min apart → score = 100 - 4 = 96 → pending_review
    const newTime = new Date('2026-03-25T08:00:00.000Z').getTime()
    const existingTime = new Date(newTime + 2 * 60 * 1000).toISOString() // 2 min later
    const newActivity = makeActivity()
    const existing = makeActivity({ id: 2, start_time: existingTime })
    const result = matchActivities(newActivity, [existing])
    expect(result.status).toBe('pending_review')
    expect(result.confidenceScore).toBeCloseTo(96, 0)
  })

  it('returns none when activity is more than 5 minutes apart', () => {
    const newTime = new Date('2026-03-25T08:00:00.000Z').getTime()
    const existingTime = new Date(newTime + 6 * 60 * 1000).toISOString() // 6 min later
    const newActivity = makeActivity()
    const existing = makeActivity({ id: 2, start_time: existingTime })
    expect(matchActivities(newActivity, [existing]).status).toBe('none')
  })

  it('returns none when activity has very different distance', () => {
    // 30% distance diff → deducts 20 points (cap), plus time penalty; score may still be > 90
    // BUG NOTE: 0 time diff, 20% distance diff → score = 100 - 20 = 80 → not > 90 → none
    const newActivity = makeActivity({ distance_meters: 10000 })
    const existing = makeActivity({ id: 2, distance_meters: 12000 }) // 20% diff
    expect(matchActivities(newActivity, [existing]).status).toBe('none')
  })

  it('returns best match when multiple candidates exist', () => {
    const newActivity = makeActivity({ start_time: '2026-03-25T08:00:00.000Z' })
    // Both within 5 minutes, but one is closer
    const close = makeActivity({ id: 10, start_time: '2026-03-25T08:01:00.000Z' })  // 1 min diff
    const further = makeActivity({ id: 20, start_time: '2026-03-25T08:04:00.000Z' }) // 4 min diff
    const result = matchActivities(newActivity, [close, further])
    expect(result.matchedActivityId).toBe(10) // Closer match wins
  })

  it('returns correct matchedActivityId', () => {
    const newActivity = makeActivity()
    const existing = makeActivity({ id: 42 })
    const result = matchActivities(newActivity, [existing])
    expect(result.matchedActivityId).toBe(42)
  })
})
