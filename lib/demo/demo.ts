/**
 * Server-side demo-account helpers.
 *
 * The demo account is a single shared athlete whose auth user id is pinned in
 * the DEMO_USER_ID env var. isDemoUser() is the cheap, DB-free check used by
 * proxy.ts and API route guards to gate demo-restricted behaviour (blocked
 * routes, shared daily LLM budget, forced provider, job exclusion).
 *
 * SERVER ONLY — reads a non-public env var. Do not import into client bundles;
 * client components detect the demo account via the `is_demo` athlete column
 * (see useIsDemo() in lib/demo/use-is-demo.ts).
 *
 * When DEMO_USER_ID is unset (demo not provisioned), this returns false for
 * everyone, so the demo feature is inert until the account is set up.
 */
export function isDemoUser(userId: string | null | undefined): boolean {
  const demoUserId = process.env.DEMO_USER_ID
  if (!demoUserId || !userId) return false
  return userId === demoUserId
}

/**
 * Routes the shared demo account may not call. Enforced in proxy.ts for the demo
 * user only. Some equally dangerous routes are public (and so bypass the proxy
 * check) — those carry in-route demo self-guards instead: /api/auth/delete-account,
 * /api/auth/garmin(/disconnect), /api/strava/callback.
 */
const DEMO_BLOCKED_EXACT = new Set([
  '/api/plans/import/parse',
  '/api/strength/parse',    // strength import: vision/LLM parse
  '/api/strength/schedule', // strength import: LLM scheduling
  '/api/strava/auth',
  '/api/garmin/workouts',
  '/api/auth/create-athlete',
])
const DEMO_BLOCKED_PREFIXES = ['/api/plans/import/']
/** Blocked only for mutating methods (reads stay allowed). */
const DEMO_BLOCKED_MUTATION_PREFIXES = ['/api/settings']
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** True when the demo account must be denied this path+method. Pure — safe to unit test. */
export function isDemoRestrictedPath(pathname: string, method: string): boolean {
  if (DEMO_BLOCKED_EXACT.has(pathname)) return true
  if (DEMO_BLOCKED_PREFIXES.some(p => pathname.startsWith(p))) return true
  if (MUTATION_METHODS.has(method.toUpperCase()) && DEMO_BLOCKED_MUTATION_PREFIXES.some(p => pathname.startsWith(p))) return true
  return false
}

/** Hard-wired cheap provider the demo account is pinned to (ignores stored settings). */
export const DEMO_LLM_PROVIDER = 'deepseek'

/**
 * LLM provider/model the demo account must use, or null for a non-demo user (the
 * caller then falls back to the athlete's stored preference).
 *
 * Demo generations are pinned to the cheap default so that even if the nightly
 * reclone copies an expensive stored preference — or a stored value is otherwise
 * present — demo traffic can never run up cost on a premium provider. Settings
 * mutations are already blocked for the demo user (see proxy.ts), so this is the
 * runtime backstop on top of that.
 */
export function demoProviderOverride(
  userId: string | null | undefined,
): { providerName: string; modelName: string | undefined } | null {
  if (!isDemoUser(userId)) return null
  return { providerName: DEMO_LLM_PROVIDER, modelName: undefined }
}
