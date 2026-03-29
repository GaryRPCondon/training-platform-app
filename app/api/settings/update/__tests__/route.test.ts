import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockRequest, makeMockSupabase } from '@/lib/__tests__/helpers/api-test-utils'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/ensure-athlete', () => ({
  ensureAthleteExists: vi.fn().mockResolvedValue({ athleteId: 'athlete-1', error: null }),
}))

import { createClient } from '@/lib/supabase/server'
const mockCreateClient = vi.mocked(createClient)

import { POST } from '../route'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/settings/update', () => {
  beforeEach(() => {
    // vi.clearAllMocks() only clears call history — implementations from vi.mock() persist
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockCreateClient.mockResolvedValue(makeMockSupabase(null) as any)
    const req = createMockRequest('/api/settings/update', {
      method: 'POST',
      body: { provider: 'anthropic' },
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 400 when selected provider has no API key configured', async () => {
    mockCreateClient.mockResolvedValue(makeMockSupabase({ id: 'user-1' }) as any)

    // 'grok' uses XAI_API_KEY — unset it for this test
    const origXai = process.env.XAI_API_KEY
    delete process.env.XAI_API_KEY

    const req = createMockRequest('/api/settings/update', {
      method: 'POST',
      body: { provider: 'grok' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('not available')

    if (origXai !== undefined) process.env.XAI_API_KEY = origXai
  })

  it('returns 200 with success:true for valid settings update (no provider)', async () => {
    const supabase = makeMockSupabase(
      { id: 'user-1' },
      (_table) => {
        const mock: any = {
          select: () => mock,
          eq: () => mock,
          update: () => mock,
        }
        mock.then = (fn: any) => Promise.resolve({ data: null, error: null }).then(fn)
        return mock
      }
    )
    mockCreateClient.mockResolvedValue(supabase as any)

    const req = createMockRequest('/api/settings/update', {
      method: 'POST',
      body: { preferred_units: 'metric', week_starts_on: 1 },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  it('returns 200 when updating first_name and last_name', async () => {
    const supabase = makeMockSupabase(
      { id: 'user-1' },
      (_table) => {
        const mock: any = { select: () => mock, eq: () => mock, update: () => mock }
        mock.then = (fn: any) => Promise.resolve({ data: null, error: null }).then(fn)
        return mock
      }
    )
    mockCreateClient.mockResolvedValue(supabase as any)

    const req = createMockRequest('/api/settings/update', {
      method: 'POST',
      body: { first_name: 'John', last_name: 'Doe' },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
  })
})
