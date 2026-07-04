/**
 * POST /api/jobs/reset-demo
 *
 * Wipes the demo account's data and re-clones it from the owner's live account
 * (see lib/demo/reset.ts). Runs nightly via Vercel cron and can be triggered
 * on-demand by an authenticated admin.
 *
 * Auth: EITHER a valid x-cron-secret header (cron) OR an authenticated admin
 * session. Public route (proxy PUBLIC_PATHS) that self-guards here.
 *
 * On failure it emails the admin (Resend) and returns 500 so a broken reset is
 * visible; the admin button can then re-run it (the reset is idempotent).
 */

import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { isUserAdmin } from '@/lib/auth/check-admin'
import { timingSafeEqualStr } from '@/lib/utils/security'
import { resetDemoAccount, type DemoResetConfig } from '@/lib/demo/reset'

async function isAuthorized(request: Request): Promise<boolean> {
  // Cron path: constant-time secret compare (fail closed if unconfigured).
  const cronSecret = request.headers.get('x-cron-secret')
  const expected = process.env.CRON_SECRET
  if (cronSecret && expected && timingSafeEqualStr(cronSecret, expected)) return true

  // Admin path: authenticated admin session.
  try {
    const supabase = await createClient()
    const { isAdmin } = await isUserAdmin(supabase)
    return isAdmin
  } catch {
    return false
  }
}

async function alertAdmin(message: string): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL
  const resendKey = process.env.RESEND_API_KEY
  if (!adminEmail || !resendKey) {
    console.warn('[reset-demo] alert skipped (ADMIN_EMAIL/RESEND_API_KEY unset):', message)
    return
  }
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'TrAIner <noreply@resend.dev>',
        to: [adminEmail],
        subject: 'Demo reset FAILED',
        html: `<p>The nightly demo reset failed:</p><pre>${message.replace(/[<>&]/g, '')}</pre>`,
      }),
    })
  } catch (err) {
    console.error('[reset-demo] admin alert failed:', err)
  }
}

export async function POST(request: Request) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const config: DemoResetConfig = {
    demoUserId: process.env.DEMO_USER_ID ?? '',
    sourceAthleteId: process.env.DEMO_SOURCE_ATHLETE_ID ?? '',
    demoEmail: process.env.DEMO_EMAIL ?? '',
    demoPassword: process.env.DEMO_PASSWORD ?? '',
  }
  if (!config.demoUserId || !config.sourceAthleteId || !config.demoEmail || !config.demoPassword) {
    return NextResponse.json({ error: 'Demo reset not configured' }, { status: 400 })
  }

  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  try {
    const result = await resetDemoAccount(admin, config)
    console.log('[reset-demo] complete', result)
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[reset-demo] failed:', message)
    await alertAdmin(message)
    return NextResponse.json({ error: 'Demo reset failed', details: message }, { status: 500 })
  }
}
