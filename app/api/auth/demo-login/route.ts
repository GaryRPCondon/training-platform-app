/**
 * POST /api/auth/demo-login
 *
 * Signs the caller into the shared public demo account using credentials held
 * only in server env vars (DEMO_EMAIL / DEMO_PASSWORD) — nothing is ever exposed
 * to the client. The login-page "Try the demo" button calls this so visitors get
 * a one-click demo session without seeing or knowing any credentials.
 *
 * Self-heal: a demo visitor could change the account password via GoTrue
 * directly (that call can't be blocked at the proxy). If sign-in fails, we reset
 * the password with the service-role admin API and retry once, so the demo
 * survives vandalism until the nightly reset re-asserts it.
 *
 * Public route (see proxy.ts PUBLIC_PATHS) and covered by the unauthenticated
 * per-IP backstop limiter. Returns 404 when the demo account is not provisioned.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export async function POST() {
  const email = process.env.DEMO_EMAIL
  const password = process.env.DEMO_PASSWORD
  const demoUserId = process.env.DEMO_USER_ID

  if (!email || !password || !demoUserId) {
    // Demo not configured — behave as if the feature doesn't exist.
    return NextResponse.json({ error: 'Demo is not available' }, { status: 404 })
  }

  const supabase = await createClient()

  // First attempt.
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (!error) {
    return NextResponse.json({ redirectTo: '/dashboard' })
  }

  // Self-heal: reset the demo password via service role, then retry once.
  try {
    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    const { error: resetError } = await admin.auth.admin.updateUserById(demoUserId, {
      password,
      email_confirm: true,
    })
    if (resetError) {
      console.error('[demo-login] password reset failed:', resetError.message)
      return NextResponse.json({ error: 'Demo is temporarily unavailable' }, { status: 503 })
    }
  } catch (err) {
    console.error('[demo-login] self-heal error:', err)
    return NextResponse.json({ error: 'Demo is temporarily unavailable' }, { status: 503 })
  }

  const { error: retryError } = await supabase.auth.signInWithPassword({ email, password })
  if (retryError) {
    console.error('[demo-login] retry after reset failed:', retryError.message)
    return NextResponse.json({ error: 'Demo is temporarily unavailable' }, { status: 503 })
  }

  return NextResponse.json({ redirectTo: '/dashboard' })
}
