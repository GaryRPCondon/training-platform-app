/**
 * Minimal Resend email sender for best-effort notifications (alerts, sign-in
 * pings). Fail-safe: logs and returns instead of throwing when RESEND_API_KEY is
 * unset or the API call fails, so callers can treat email as fire-and-forget
 * without guarding every call site.
 */

const RESEND_FROM = 'TrAIner <noreply@resend.dev>'

export async function sendResendEmail(opts: {
  to: string | string[]
  subject: string
  html: string
}): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    console.warn('[email] send skipped (RESEND_API_KEY unset):', opts.subject)
    return
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: Array.isArray(opts.to) ? opts.to : [opts.to],
        subject: opts.subject,
        html: opts.html,
      }),
    })
    if (!res.ok) {
      console.error('[email] Resend responded', res.status, await res.text().catch(() => ''))
    }
  } catch (err) {
    console.error('[email] send failed:', err)
  }
}

/** Escape user-controlled text for safe interpolation into notification HTML. No regex (prod runtime). */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
