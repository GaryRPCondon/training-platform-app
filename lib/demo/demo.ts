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
