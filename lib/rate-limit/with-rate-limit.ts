import { createClient } from '@/lib/supabase/server'
import { getClientIp, getRateLimiter, rateLimitResponse, type RateLimitTier } from './limiter'

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
    const key = await resolveKey(request)

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

/** user.id when authenticated, else client IP. */
async function resolveKey(request: Request): Promise<string> {
  try {
    const supabase = await createClient()
    const { data } = await supabase.auth.getUser()
    if (data.user) return `user:${data.user.id}`
  } catch {
    // Fall through to IP keying.
  }
  return `ip:${getClientIp(request)}`
}
