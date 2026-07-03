import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { NextResponse } from 'next/server'

/**
 * Inbound API rate limiting backed by Upstash Redis (serverless-native, atomic,
 * survives across function invocations — in-memory counters do not).
 *
 * Limits are keyed by the authenticated user.id (see with-rate-limit.ts); this is
 * forward-compatible with a future token-bearing Garmin Connect IQ client, whose
 * token resolves to the same user.id. IP keying is only a fallback for requests
 * with no resolved user.
 *
 * Fail-open: if the Upstash env vars are absent (local dev / CI) or Redis is
 * unreachable, the limiter allows the request. This keeps `npm run dev` and the
 * test suite working without Upstash and degrades safely in an outage.
 */

export type RateLimitTier = 'chat' | 'generation' | 'sync' | 'ip'

/** A single result shape regardless of whether Upstash is configured. */
export interface RateLimitResult {
  success: boolean
  limit: number
  remaining: number
  /** Unix epoch (ms) when the current window resets. */
  reset: number
}

interface TierLimiter {
  limit(key: string): Promise<RateLimitResult>
}

/**
 * Per-tier sliding-window limits, centralised so they're tunable in one place.
 *   chat       — interactive AI coach (a human types, so generous).
 *   generation — heavy LLM plan calls (slow + costly, so tight).
 *   sync       — external integrations (also self-guarded by a per-athlete lock).
 *   ip         — coarse per-IP backstop for UNAUTHENTICATED requests, enforced in
 *                proxy.ts (anti-DDOS / signup-spam). Authenticated traffic is keyed
 *                per-user at the route level instead and is exempt from this tier.
 */
const TIER_CONFIG: Record<RateLimitTier, { tokens: number; window: `${number} s` }> = {
  chat: { tokens: 30, window: '60 s' },
  generation: { tokens: 10, window: '60 s' },
  sync: { tokens: 12, window: '60 s' },
  ip: { tokens: 60, window: '60 s' },
}

/** No-op limiter used when Upstash is not configured (fail-open). */
const ALLOW_ALL: TierLimiter = {
  limit: async () => ({ success: true, limit: 0, remaining: 0, reset: 0 }),
}

function buildLimiters(): Record<RateLimitTier, TierLimiter> {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN

  if (!url || !token) {
    return { chat: ALLOW_ALL, generation: ALLOW_ALL, sync: ALLOW_ALL, ip: ALLOW_ALL }
  }

  const redis = new Redis({ url, token })
  const make = (tier: RateLimitTier) =>
    new Ratelimit({
      redis,
      prefix: `ratelimit:${tier}`,
      limiter: Ratelimit.slidingWindow(TIER_CONFIG[tier].tokens, TIER_CONFIG[tier].window),
      analytics: false,
    })

  return { chat: make('chat'), generation: make('generation'), sync: make('sync'), ip: make('ip') }
}

// Module-scoped singleton — reused across warm serverless invocations.
let limiters: Record<RateLimitTier, TierLimiter> | null = null

export function getRateLimiter(tier: RateLimitTier): TierLimiter {
  if (!limiters) limiters = buildLimiters()
  return limiters[tier]
}

/**
 * Demo-account daily budget.
 *
 * The shared public demo account gets a hard per-day cap on LLM traffic on top of
 * the normal per-minute tier limits. Only the LLM tiers are budgeted:
 *   chat       — DEMO_DAILY_CHAT       (default 100)
 *   generation — DEMO_DAILY_GENERATION (default 10)
 *
 * A fixed 86400 s window aligns to UTC midnight (Unix-epoch multiples of a day),
 * so the budget resets at 00:00 UTC.
 *
 * FAIL-CLOSED — the opposite of the fail-open tiers above. If Upstash is
 * unconfigured or errors, the demo request is DENIED, so a limiter outage can
 * never let the shared account run up unbounded cost. This only affects the demo
 * user; every other caller is untouched.
 */
export type DemoDailyTier = 'chat' | 'generation'

const DEMO_DAILY_DEFAULTS: Record<DemoDailyTier, number> = { chat: 100, generation: 10 }

function demoDailyCap(tier: DemoDailyTier): number {
  const raw = tier === 'chat' ? process.env.DEMO_DAILY_CHAT : process.env.DEMO_DAILY_GENERATION
  const parsed = raw ? parseInt(raw, 10) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEMO_DAILY_DEFAULTS[tier]
}

/** Unix epoch (ms) of the next UTC midnight — the reset instant reported on denial. */
function nextUtcMidnight(): number {
  const now = new Date()
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
}

let demoLimiters: Partial<Record<DemoDailyTier, Ratelimit>> = {}

function getDemoDailyLimiter(tier: DemoDailyTier): Ratelimit | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null

  const existing = demoLimiters[tier]
  if (existing) return existing

  const limiter = new Ratelimit({
    redis: new Redis({ url, token }),
    prefix: `ratelimit:demo:${tier}`,
    limiter: Ratelimit.fixedWindow(demoDailyCap(tier), '86400 s'),
    analytics: false,
  })
  demoLimiters[tier] = limiter
  return limiter
}

/**
 * Check (and consume) one unit of the demo account's daily budget for a tier.
 * Fail-closed: returns `success:false` when the limiter is unavailable.
 */
export async function checkDemoDailyBudget(tier: DemoDailyTier, key: string): Promise<RateLimitResult> {
  const denied: RateLimitResult = { success: false, limit: demoDailyCap(tier), remaining: 0, reset: nextUtcMidnight() }
  const limiter = getDemoDailyLimiter(tier)
  if (!limiter) return denied
  try {
    return await limiter.limit(key)
  } catch (err) {
    console.error('[rate-limit] demo daily limiter error, denying (fail closed):', err)
    return denied
  }
}

/** 429 response for an exhausted demo budget, with a body the UI can detect. */
export function demoBudgetResponse(result: RateLimitResult): NextResponse {
  const retryAfter = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000))
  return NextResponse.json(
    {
      error: 'demo_budget_exhausted',
      details: "Today's shared demo AI budget is used up. It resets at midnight UTC.",
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfter),
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Reset': String(result.reset),
      },
    }
  )
}

/** Best-effort client IP from the standard proxy headers (first hop wins). */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  const ip = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip')?.trim()
  return ip || 'unknown'
}

/** Standard 429 response shared by the route wrapper and the proxy IP backstop. */
export function rateLimitResponse(result: RateLimitResult): NextResponse {
  const retryAfter = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000))
  return NextResponse.json(
    { error: 'Rate limit exceeded', details: `Too many requests. Retry in ${retryAfter}s.` },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfter),
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Reset': String(result.reset),
      },
    }
  )
}
