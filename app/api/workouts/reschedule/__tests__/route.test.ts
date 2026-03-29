import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockRequest, makeMockSupabase } from '@/lib/__tests__/helpers/api-test-utils'

// ---------------------------------------------------------------------------
// Mock Supabase server — factory must not reference outer const (hoisting)
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

import { createClient } from '@/lib/supabase/server'
const mockCreateClient = vi.mocked(createClient)

import { POST } from '../route'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/workouts/reschedule', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockCreateClient.mockResolvedValue(makeMockSupabase(null) as any)
    const req = createMockRequest('/api/workouts/reschedule', {
      method: 'POST',
      body: { workoutId: 1, newDate: '2026-04-01' },
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Unauthorized')
  })

  it('returns 400 when workoutId is missing', async () => {
    mockCreateClient.mockResolvedValue(makeMockSupabase({ id: 'user-1' }) as any)
    const req = createMockRequest('/api/workouts/reschedule', {
      method: 'POST',
      body: { newDate: '2026-04-01' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('required')
  })

  it('returns 400 when newDate is missing', async () => {
    mockCreateClient.mockResolvedValue(makeMockSupabase({ id: 'user-1' }) as any)
    const req = createMockRequest('/api/workouts/reschedule', {
      method: 'POST',
      body: { workoutId: 1 },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 404 when workout not found or belongs to another user', async () => {
    const supabase = makeMockSupabase(
      { id: 'user-1' },
      (_table) => {
        const mock: any = {
          select: () => mock,
          eq: () => mock,
          update: () => mock,
          single: () => Promise.resolve({ data: null, error: { message: 'Not found' } }),
        }
        mock.then = (fn: any) => Promise.resolve({ data: null, error: null }).then(fn)
        return mock
      }
    )
    mockCreateClient.mockResolvedValue(supabase as any)

    const req = createMockRequest('/api/workouts/reschedule', {
      method: 'POST',
      body: { workoutId: 99, newDate: '2026-04-01' },
    })
    const res = await POST(req)
    expect(res.status).toBe(404)
  })

  it('returns 200 with success:true for valid reschedule', async () => {
    let callCount = 0
    const supabase = makeMockSupabase(
      { id: 'user-1' },
      (_table) => {
        callCount++
        const mock: any = {
          select: () => mock,
          eq: () => mock,
          update: () => mock,
          single: () => Promise.resolve({ data: { id: 1 }, error: null }),
        }
        mock.then = (fn: any) => Promise.resolve({ data: null, error: null }).then(fn)
        return mock
      }
    )
    mockCreateClient.mockResolvedValue(supabase as any)

    const req = createMockRequest('/api/workouts/reschedule', {
      method: 'POST',
      body: { workoutId: 1, newDate: '2026-04-01' },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })
})
