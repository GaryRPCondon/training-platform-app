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

  // Capture the payload passed to .update() so we can assert what is/isn't written.
  function makeCapturingSupabase(captured: { payload?: Record<string, unknown> }) {
    return makeMockSupabase(
      { id: 'user-1' },
      (_table) => {
        const mock: any = {
          select: () => mock,
          eq: () => mock,
          update: (payload: Record<string, unknown>) => { captured.payload = payload; return mock },
        }
        mock.then = (fn: any) => Promise.resolve({ data: null, error: null }).then(fn)
        return mock
      }
    )
  }

  it('demo account: strips identity/cost fields, keeps only safe preferences', async () => {
    const origDemo = process.env.DEMO_USER_ID
    const origKey = process.env.ANTHROPIC_API_KEY
    process.env.DEMO_USER_ID = 'user-1' // makes isDemoUser('user-1') true
    process.env.ANTHROPIC_API_KEY = 'test-key' // so provider passes availability check before being stripped

    const captured: { payload?: Record<string, unknown> } = {}
    mockCreateClient.mockResolvedValue(makeCapturingSupabase(captured) as any)

    const req = createMockRequest('/api/settings/update', {
      method: 'POST',
      body: { provider: 'anthropic', first_name: 'Hacker', preferred_units: 'imperial', week_starts_on: 1, locale: 'en-XA' },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(captured.payload).toEqual({ preferred_units: 'imperial', week_starts_on: 1, locale: 'en-XA' })
    expect(captured.payload?.preferred_llm_provider).toBeUndefined()
    expect(captured.payload?.first_name).toBeUndefined()

    if (origDemo === undefined) delete process.env.DEMO_USER_ID; else process.env.DEMO_USER_ID = origDemo
    if (origKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = origKey
  })

  it('demo account: a request carrying only stripped fields succeeds without writing', async () => {
    const origDemo = process.env.DEMO_USER_ID
    process.env.DEMO_USER_ID = 'user-1'

    const captured: { payload?: Record<string, unknown> } = {}
    mockCreateClient.mockResolvedValue(makeCapturingSupabase(captured) as any)

    const req = createMockRequest('/api/settings/update', {
      method: 'POST',
      body: { first_name: 'Hacker', ai_summaries_enabled: false },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(captured.payload).toBeUndefined() // no UPDATE issued

    if (origDemo === undefined) delete process.env.DEMO_USER_ID; else process.env.DEMO_USER_ID = origDemo
  })

  it('non-demo account: all provided fields are written unchanged', async () => {
    const origDemo = process.env.DEMO_USER_ID
    const origKey = process.env.ANTHROPIC_API_KEY
    process.env.DEMO_USER_ID = 'a-different-user' // user-1 is NOT the demo user
    process.env.ANTHROPIC_API_KEY = 'test-key'

    const captured: { payload?: Record<string, unknown> } = {}
    mockCreateClient.mockResolvedValue(makeCapturingSupabase(captured) as any)

    const req = createMockRequest('/api/settings/update', {
      method: 'POST',
      body: { provider: 'anthropic', first_name: 'John', preferred_units: 'metric' },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(captured.payload?.preferred_llm_provider).toBe('anthropic')
    expect(captured.payload?.first_name).toBe('John')
    expect(captured.payload?.preferred_units).toBe('metric')

    if (origDemo === undefined) delete process.env.DEMO_USER_ID; else process.env.DEMO_USER_ID = origDemo
    if (origKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = origKey
  })
})
