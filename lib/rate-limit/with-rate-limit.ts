import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getRateLimiter, type RateLimitTier } from './limiter'

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
      const { success, limit, remaining, reset } = await getRateLimiter(tier).limit(key)
      if (!success) {
        const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000))
        return NextResponse.json(
          { error: 'Rate limit exceeded', details: `Too many requests. Retry in ${retryAfter}s.` },
          {
            status: 429,
            headers: {
              'Retry-After': String(retryAfter),
              'X-RateLimit-Limit': String(limit),
              'X-RateLimit-Remaining': String(remaining),
              'X-RateLimit-Reset': String(reset),
            },
          }
        )
      }
    } catch (error) {
      // Fail open: a limiter/Redis outage must not take down the API.
      console.error('[rate-limit] limiter error, allowing request:', error)
    }

    return handler(request, ...args)
  }
}

/** user.id when authenticated, else client IP, else a shared anonymous bucket. */
async function resolveKey(request: Request): Promise<string> {
  try {
    const supabase = await createClient()
    const { data } = await supabase.auth.getUser()
    if (data.user) return `user:${data.user.id}`
  } catch {
    // Fall through to IP keying.
  }

  const forwarded = request.headers.get('x-forwarded-for')
  const ip = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip')?.trim()
  return ip ? `ip:${ip}` : 'ip:unknown'
}
