import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockRequest, makeMockSupabase } from '@/lib/__tests__/helpers/api-test-utils'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

import { createClient } from '@/lib/supabase/server'
const mockCreateClient = vi.mocked(createClient)

import { POST } from '../route'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/activities/merge/approve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockCreateClient.mockResolvedValue(makeMockSupabase(null) as any)
    const req = createMockRequest('/api/activities/merge/approve', {
      method: 'POST',
      body: { activity1Id: 1, activity2Id: 2 },
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 400 when activity1Id is missing', async () => {
    mockCreateClient.mockResolvedValue(makeMockSupabase({ id: 'user-1' }) as any)
    const req = createMockRequest('/api/activities/merge/approve', {
      method: 'POST',
      body: { activity2Id: 2 },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Invalid request')
  })

  it('returns 400 when activity2Id is missing', async () => {
    mockCreateClient.mockResolvedValue(makeMockSupabase({ id: 'user-1' }) as any)
    const req = createMockRequest('/api/activities/merge/approve', {
      method: 'POST',
      body: { activity1Id: 1 },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 404 when activities not found for user', async () => {
    const supabase = makeMockSupabase(
      { id: 'user-1' },
      (_table) => {
        const mock: any = {
          select: () => mock,
          eq: () => mock,
          in: () => mock,
          update: () => mock,
          delete: () => mock,
        }
        // Returns only 1 activity (not the expected 2)
        mock.then = (fn: any) => Promise.resolve({
          data: [{ id: 1, garmin_id: 'g1', strava_id: null, source: 'garmin', synced_from_garmin: null, synced_from_strava: null }],
          error: null
        }).then(fn)
        return mock
      }
    )
    mockCreateClient.mockResolvedValue(supabase as any)

    const req = createMockRequest('/api/activities/merge/approve', {
      method: 'POST',
      body: { activity1Id: 1, activity2Id: 2 },
    })
    const res = await POST(req)
    expect(res.status).toBe(404)
  })

  it('returns 200 with success:true when merge succeeds', async () => {
    const twoActivities = [
      { id: 1, garmin_id: 'g1', strava_id: null, source: 'garmin', synced_from_garmin: null, synced_from_strava: null },
      { id: 2, garmin_id: null, strava_id: 's1', source: 'strava', synced_from_garmin: null, synced_from_strava: null },
    ]
    const supabase = makeMockSupabase(
      { id: 'user-1' },
      (_table) => {
        const mock: any = {
          select: () => mock,
          eq: () => mock,
          in: () => mock,
          update: () => mock,
          delete: () => mock,
        }
        mock.then = (fn: any) => Promise.resolve({ data: twoActivities, error: null }).then(fn)
        return mock
      }
    )
    mockCreateClient.mockResolvedValue(supabase as any)

    const req = createMockRequest('/api/activities/merge/approve', {
      method: 'POST',
      body: { activity1Id: 1, activity2Id: 2 },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })
})
