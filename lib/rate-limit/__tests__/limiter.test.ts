import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Fail-open contract: with the Upstash env vars absent (the default in dev/CI),
 * the limiter must allow every request so the API and the rest of the test suite
 * keep working without Redis.
 */
describe('getRateLimiter (unconfigured)', () => {
  const original = {
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  }

  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    vi.resetModules() // rebuild the module-scoped singleton with env unset
  })

  afterEach(() => {
    if (original.url) process.env.UPSTASH_REDIS_REST_URL = original.url
    if (original.token) process.env.UPSTASH_REDIS_REST_TOKEN = original.token
  })

  it('allows all requests across every tier', async () => {
    const { getRateLimiter } = await import('@/lib/rate-limit/limiter')

    for (const tier of ['chat', 'generation', 'sync', 'ip'] as const) {
      const result = await getRateLimiter(tier).limit('user:anyone')
      expect(result.success).toBe(true)
    }
  })
})
