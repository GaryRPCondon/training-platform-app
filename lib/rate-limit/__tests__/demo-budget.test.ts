import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { checkDemoDailyBudget, demoBudgetResponse } from '@/lib/rate-limit/limiter'

/**
 * Fail-CLOSED contract for the demo daily budget — the deliberate inverse of the
 * fail-open per-minute tiers. With Upstash unconfigured (the default in dev/CI),
 * a demo LLM request must be DENIED so the shared account can never run up cost
 * during a limiter outage.
 */
describe('checkDemoDailyBudget (fail closed)', () => {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN

  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
  })
  afterEach(() => {
    if (url === undefined) delete process.env.UPSTASH_REDIS_REST_URL
    else process.env.UPSTASH_REDIS_REST_URL = url
    if (token === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN
    else process.env.UPSTASH_REDIS_REST_TOKEN = token
  })

  it('denies chat when the limiter is unconfigured', async () => {
    const result = await checkDemoDailyBudget('chat', 'demo:chat:x')
    expect(result.success).toBe(false)
  })

  it('denies generation when the limiter is unconfigured', async () => {
    const result = await checkDemoDailyBudget('generation', 'demo:generation:x')
    expect(result.success).toBe(false)
  })

  it('reports a reset at a future UTC midnight', async () => {
    const result = await checkDemoDailyBudget('chat', 'demo:chat:x')
    expect(result.reset).toBeGreaterThan(Date.now())
    const reset = new Date(result.reset)
    expect(reset.getUTCHours()).toBe(0)
    expect(reset.getUTCMinutes()).toBe(0)
    expect(reset.getUTCSeconds()).toBe(0)
  })
})

describe('demoBudgetResponse', () => {
  it('returns a 429 with the detectable demo_budget_exhausted error code', async () => {
    const res = demoBudgetResponse({ success: false, limit: 100, remaining: 0, reset: Date.now() + 5000 })
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.error).toBe('demo_budget_exhausted')
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1)
  })
})
