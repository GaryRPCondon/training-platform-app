import { describe, it, expect } from 'vitest'
import { getClientIp, rateLimitResponse } from '@/lib/rate-limit/limiter'

function req(headers: Record<string, string>): Request {
  return new Request('http://localhost/api/x', { headers })
}

describe('getClientIp', () => {
  it('takes the first hop from x-forwarded-for', () => {
    expect(getClientIp(req({ 'x-forwarded-for': '203.0.113.7, 70.41.3.18' }))).toBe('203.0.113.7')
  })

  it('falls back to x-real-ip', () => {
    expect(getClientIp(req({ 'x-real-ip': '198.51.100.5' }))).toBe('198.51.100.5')
  })

  it('returns "unknown" when no IP headers are present', () => {
    expect(getClientIp(req({}))).toBe('unknown')
  })
})

describe('rateLimitResponse', () => {
  it('returns a 429 with Retry-After and X-RateLimit-* headers', async () => {
    const reset = Date.now() + 4200
    const res = rateLimitResponse({ success: false, limit: 60, remaining: 0, reset })

    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.error).toBe('Rate limit exceeded')
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1)
    expect(res.headers.get('X-RateLimit-Limit')).toBe('60')
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0')
    expect(res.headers.get('X-RateLimit-Reset')).toBe(String(reset))
  })
})
