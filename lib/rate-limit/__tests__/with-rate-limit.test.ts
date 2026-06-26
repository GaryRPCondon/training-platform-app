import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockRequest, makeMockSupabase } from '@/lib/__tests__/helpers/api-test-utils'
import { createClient } from '@/lib/supabase/server'
import { getRateLimiter, type RateLimitResult } from '@/lib/rate-limit/limiter'
import { withRateLimit } from '@/lib/rate-limit/with-rate-limit'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/rate-limit/limiter', () => ({ getRateLimiter: vi.fn() }))

const mockCreateClient = vi.mocked(createClient)
const mockGetRateLimiter = vi.mocked(getRateLimiter)

/** Helper: stub the limiter to return a fixed result (or throw). */
function stubLimiter(result: RateLimitResult | Error) {
  const limit = vi.fn(async (key: string) => {
    if (result instanceof Error) throw result
    return result
  })
  mockGetRateLimiter.mockReturnValue({ limit })
  return limit
}

const handler = vi.fn(async () => new Response('ok', { status: 200 }))

beforeEach(() => {
  vi.clearAllMocks()
  mockCreateClient.mockResolvedValue(makeMockSupabase({ id: 'user-1' }) as never)
})

describe('withRateLimit', () => {
  it('calls the wrapped handler when under the limit', async () => {
    stubLimiter({ success: true, limit: 30, remaining: 29, reset: Date.now() + 60000 })
    const wrapped = withRateLimit('chat', handler)

    const res = await wrapped(createMockRequest('/api/agent/chat', { method: 'POST' }))

    expect(handler).toHaveBeenCalledOnce()
    expect(res.status).toBe(200)
  })

  it('returns 429 with headers and does not call the handler when over the limit', async () => {
    const reset = Date.now() + 5000
    stubLimiter({ success: false, limit: 30, remaining: 0, reset })
    const wrapped = withRateLimit('chat', handler)

    const res = await wrapped(createMockRequest('/api/agent/chat', { method: 'POST' }))

    expect(handler).not.toHaveBeenCalled()
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.error).toBe('Rate limit exceeded')
    expect(res.headers.get('Retry-After')).toBeTruthy()
    expect(res.headers.get('X-RateLimit-Limit')).toBe('30')
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0')
    expect(res.headers.get('X-RateLimit-Reset')).toBe(String(reset))
  })

  it('keys by authenticated user.id', async () => {
    const limit = stubLimiter({ success: true, limit: 30, remaining: 29, reset: 0 })
    const wrapped = withRateLimit('sync', handler)

    await wrapped(createMockRequest('/api/sync/garmin', { method: 'POST' }))

    expect(limit).toHaveBeenCalledWith('user:user-1')
  })

  it('falls back to the client IP when unauthenticated', async () => {
    mockCreateClient.mockResolvedValue(makeMockSupabase(null) as never)
    const limit = stubLimiter({ success: true, limit: 30, remaining: 29, reset: 0 })
    const wrapped = withRateLimit('sync', handler)

    await wrapped(
      createMockRequest('/api/sync/garmin', {
        method: 'POST',
        headers: { 'x-forwarded-for': '203.0.113.7, 70.41.3.18' },
      })
    )

    expect(limit).toHaveBeenCalledWith('ip:203.0.113.7')
  })

  it('fails open (calls the handler) when the limiter throws', async () => {
    stubLimiter(new Error('redis unreachable'))
    const wrapped = withRateLimit('generation', handler)

    const res = await wrapped(createMockRequest('/api/plans/generate', { method: 'POST' }))

    expect(handler).toHaveBeenCalledOnce()
    expect(res.status).toBe(200)
  })
})
