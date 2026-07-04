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
 *
 * Optionally pings the owner (DEMO_LOGIN_ALERT_EMAIL) on each successful sign-in.
 * That notification is best-effort and scheduled with after() so it never blocks
 * or fails the login itself.
 */

import { NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { sendResendEmail, escapeHtml } from '@/lib/email/resend'

/**
 * Best-effort "someone opened the demo" email. Gated on DEMO_LOGIN_ALERT_EMAIL
 * (unset → no-op), and the sender is itself fail-safe, so this never throws.
 */
async function notifyDemoLogin(request: Request): Promise<void> {
  const to = process.env.DEMO_LOGIN_ALERT_EMAIL
  if (!to) return
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const ua = request.headers.get('user-agent') || 'unknown'
  const when = new Date().toISOString()
  await sendResendEmail({
    to,
    subject: 'Demo account login',
    html: `<p>Someone signed into the demo account.</p><ul><li>Time (UTC): ${escapeHtml(when)}</li><li>IP: ${escapeHtml(ip)}</li><li>User agent: ${escapeHtml(ua)}</li></ul>`,
  })
}

export async function POST(request: Request) {
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
    after(() => notifyDemoLogin(request))
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

  after(() => notifyDemoLogin(request))
  return NextResponse.json({ redirectTo: '/dashboard' })
}
