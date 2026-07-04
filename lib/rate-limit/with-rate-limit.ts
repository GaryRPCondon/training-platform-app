import { createClient } from '@/lib/supabase/server'
import {
  getClientIp,
  getRateLimiter,
  rateLimitResponse,
  checkDemoDailyBudget,
  demoBudgetResponse,
  type RateLimitTier,
  type DemoDailyTier,
} from './limiter'
import { isDemoUser } from '@/lib/demo/demo'

/**
 * Wraps an App Router route handler with inbound rate limiting.
 *
 * Usage (the only change to a route is its export line):
 *   async function postHandler(request: Request) { ... }
 *   export const POST = withRateLimit('chat', postHandler)
 *
 * The limit is keyed by the authenticated user.id when present, falling back to
 * the client IP for unauthenticated requests so pre-auth abuse is still bounded.
 * The wrapped handler runs unchanged and still performs its own auth checks.
 */
export function withRateLimit<R extends Request, A extends unknown[]>(
  tier: RateLimitTier,
  handler: (request: R, ...args: A) => Promise<Response>
): (request: R, ...args: A) => Promise<Response> {
  return async (request: R, ...args: A): Promise<Response> => {
    const { key, userId } = await resolveKey(request)

    // Demo account: enforce a hard daily budget on LLM tiers ON TOP of the
    // per-minute limit. Fail-closed (see checkDemoDailyBudget) so a limiter
    // outage can't uncap the shared account's cost.
    const demoTier = toDemoTier(tier)
    if (demoTier && userId && isDemoUser(userId)) {
      const daily = await checkDemoDailyBudget(demoTier, `demo:${demoTier}:${userId}`)
      if (!daily.success) return demoBudgetResponse(daily)
    }

    try {
      const result = await getRateLimiter(tier).limit(key)
      if (!result.success) return rateLimitResponse(result)
    } catch (error) {
      // Fail open: a limiter/Redis outage must not take down the API.
      console.error('[rate-limit] limiter error, allowing request:', error)
    }

    return handler(request, ...args)
  }
}

/** The two LLM tiers that carry a demo daily budget; null for tiers that don't. */
function toDemoTier(tier: RateLimitTier): DemoDailyTier | null {
  return tier === 'chat' || tier === 'generation' ? tier : null
}

/** Resolve the rate-limit key and the authenticated user id (null if unauthenticated). */
async function resolveKey(request: Request): Promise<{ key: string; userId: string | null }> {
  try {
    const supabase = await createClient()
    const { data } = await supabase.auth.getUser()
    if (data.user) return { key: `user:${data.user.id}`, userId: data.user.id }
  } catch {
    // Fall through to IP keying.
  }
  return { key: `ip:${getClientIp(request)}`, userId: null }
}
