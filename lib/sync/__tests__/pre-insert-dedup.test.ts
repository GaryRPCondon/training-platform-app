import { describe, it, expect, vi, beforeEach } from 'vitest'
import { findExistingMatch } from '../pre-insert-dedup'

// ---------------------------------------------------------------------------
// Supabase mock
// ---------------------------------------------------------------------------

function makeQueryMock(data: any, error: any = null) {
  const result = { data, error }
  const mock: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
  }
  // Make thenable for list queries (await supabase.from(...).select(...).eq(...).gte(...).lte(...))
  mock.then = (onfulfilled: any, onrejected?: any) =>
    Promise.resolve(result).then(onfulfilled, onrejected)
  return mock
}

function makeSupabase(queryData: any) {
  return { from: vi.fn(() => makeQueryMock(queryData)) } as any
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_TIME = '2026-03-25T08:00:00.000Z'

const garminActivity = {
  id: 100,
  start_time: BASE_TIME,
  distance_meters: 10000,
  duration_seconds: 3600,
  source: 'garmin',
  garmin_id: 'g1',
  strava_id: null,
}

const stravaActivity = {
  id: 200,
  start_time: BASE_TIME,        // Exact same time
  distance_meters: 10000,       // Same distance
  duration_seconds: 3600,
  source: 'strava',
  garmin_id: null,
  strava_id: 's1',
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('findExistingMatch', () => {
  it('returns null when no activities found within 12-hour window', async () => {
    const supabase = makeSupabase([])
    const result = await findExistingMatch(supabase, 'athlete-1', {
      start_time: BASE_TIME,
      distance_meters: 10000,
      duration_seconds: 3600,
      source: 'strava',
    })
    expect(result).toBeNull()
  })

  it('returns null when no high-confidence match found', async () => {
    // Existing activity has 20% different distance → no match
    const existing = { ...garminActivity, distance_meters: 12000 }
    const supabase = makeSupabase([existing])
    const result = await findExistingMatch(supabase, 'athlete-1', {
      start_time: BASE_TIME,
      distance_meters: 10000,
      duration_seconds: 3600,
      source: 'strava',
    })
    expect(result).toBeNull()
  })

  it('returns existing activity when high-confidence match found', async () => {
    const supabase = makeSupabase([garminActivity])
    const result = await findExistingMatch(supabase, 'athlete-1', {
      start_time: BASE_TIME,
      distance_meters: 10000,
      duration_seconds: 3600,
      source: 'strava',
    })
    expect(result).not.toBeNull()
    expect(result!.id).toBe(100)
  })

  it('returns null when existing is from same source', async () => {
    // Same source → findMergeCandidates skips it
    const sameSource = { ...garminActivity, source: 'strava' }
    const supabase = makeSupabase([sameSource])
    const result = await findExistingMatch(supabase, 'athlete-1', {
      start_time: BASE_TIME,
      distance_meters: 10000,
      duration_seconds: 3600,
      source: 'strava',
    })
    expect(result).toBeNull()
  })

  it('queries with 12-hour window around the activity start_time', async () => {
    const supabase = makeSupabase([])
    await findExistingMatch(supabase, 'athlete-1', {
      start_time: BASE_TIME,
      distance_meters: 10000,
      duration_seconds: 3600,
      source: 'strava',
    })
    expect(supabase.from).toHaveBeenCalledWith('activities')
    const fromResult = supabase.from.mock.results[0].value
    expect(fromResult.eq).toHaveBeenCalledWith('athlete_id', 'athlete-1')
    // Verify gte and lte were called (12-hour window)
    expect(fromResult.gte).toHaveBeenCalled()
    expect(fromResult.lte).toHaveBeenCalled()
  })

  it('returns null when potentialMatches is null (DB error)', async () => {
    const supabase = makeSupabase(null)
    const result = await findExistingMatch(supabase, 'athlete-1', {
      start_time: BASE_TIME,
      distance_meters: 10000,
      duration_seconds: 3600,
      source: 'strava',
    })
    expect(result).toBeNull()
  })
})
