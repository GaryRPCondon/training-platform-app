import crypto from 'crypto'

/**
 * Generate an HMAC-based approval token for a given athlete ID.
 */
export function generateApprovalToken(athleteId: string): string {
    const secret = process.env.ADMIN_APPROVAL_SECRET
    if (!secret) throw new Error('ADMIN_APPROVAL_SECRET not set')
    return crypto.createHmac('sha256', secret).update(athleteId).digest('hex')
}

/**
 * Verify an approval token matches the expected athlete ID.
 */
export function verifyApprovalToken(athleteId: string, token: string): boolean {
    const expected = generateApprovalToken(athleteId)
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token))
}

/**
 * Send an email to the admin notifying them of a new signup.
 * Uses Resend API if RESEND_API_KEY is set, otherwise logs a warning.
 */
export async function notifyAdminOfSignup(athleteId: string, email: string): Promise<void> {
    const adminEmail = process.env.ADMIN_EMAIL
    const resendKey = process.env.RESEND_API_KEY
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    if (!adminEmail) {
        console.warn('ADMIN_EMAIL not set — skipping signup notification')
        return
    }

    const token = generateApprovalToken(athleteId)
    const approvalUrl = `${appUrl}/api/auth/approve?id=${athleteId}&token=${token}`

    if (!resendKey) {
        console.warn('RESEND_API_KEY not set — skipping email. Approval URL:', approvalUrl)
        return
    }

    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            from: 'TrAIner <noreply@resend.dev>',
            to: [adminEmail],
            subject: `New TrAIner signup: ${email}`,
            html: `
                <h2>New Account Signup</h2>
                <p><strong>${email}</strong> has signed up for TrAIner and is awaiting approval.</p>
                <p>
                    <a href="${approvalUrl}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">
                        Approve Account
                    </a>
                </p>
                <p style="color:#666;font-size:12px;margin-top:24px;">
                    Or copy this link: ${approvalUrl}
                </p>
            `,
        }),
    })

    if (!res.ok) {
        const body = await res.text()
        throw new Error(`Resend API error ${res.status}: ${body}`)
    }
}

/**
 * Notify a user that their account has been approved.
 */
export async function notifyUserOfApproval(userEmail: string): Promise<void> {
    const resendKey = process.env.RESEND_API_KEY
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    if (!resendKey) {
        console.warn('RESEND_API_KEY not set — skipping user approval notification')
        return
    }

    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            from: 'TrAIner <noreply@resend.dev>',
            to: [userEmail],
            subject: 'Your TrAIner account has been approved',
            html: `
                <h2>Welcome to TrAIner!</h2>
                <p>Your account has been approved. You can now log in and start using the platform.</p>
                <p>
                    <a href="${appUrl}/login" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">
                        Log In
                    </a>
                </p>
            `,
        }),
    })

    if (!res.ok) {
        const body = await res.text()
        throw new Error(`Resend API error ${res.status}: ${body}`)
    }
}
