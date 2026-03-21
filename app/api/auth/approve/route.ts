import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyApprovalToken, notifyUserOfApproval } from '@/lib/email/notify-admin'

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url)
    const athleteId = searchParams.get('id')
    const token = searchParams.get('token')

    if (!athleteId || !token) {
        return new NextResponse(htmlPage('Invalid Link', 'Missing required parameters.'), {
            status: 400,
            headers: { 'Content-Type': 'text/html' },
        })
    }

    try {
        if (!verifyApprovalToken(athleteId, token)) {
            return new NextResponse(htmlPage('Invalid Token', 'The approval token is invalid or has expired.'), {
                status: 403,
                headers: { 'Content-Type': 'text/html' },
            })
        }
    } catch {
        return new NextResponse(htmlPage('Server Error', 'ADMIN_APPROVAL_SECRET is not configured.'), {
            status: 500,
            headers: { 'Content-Type': 'text/html' },
        })
    }

    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Check current status for idempotency
    const { data: athlete } = await supabaseAdmin
        .from('athletes')
        .select('account_status, email')
        .eq('id', athleteId)
        .single()

    if (!athlete) {
        return new NextResponse(htmlPage('Not Found', 'This athlete account no longer exists.'), {
            status: 404,
            headers: { 'Content-Type': 'text/html' },
        })
    }

    if (athlete.account_status === 'approved') {
        return new NextResponse(htmlPage('Already Approved', `The account for <strong>${athlete.email}</strong> has already been approved.`), {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
        })
    }

    const { error } = await supabaseAdmin
        .from('athletes')
        .update({ account_status: 'approved' })
        .eq('id', athleteId)

    if (error) {
        return new NextResponse(htmlPage('Error', 'Failed to approve the account. Please try again.'), {
            status: 500,
            headers: { 'Content-Type': 'text/html' },
        })
    }

    // Notify the user (non-blocking)
    notifyUserOfApproval(athlete.email).catch(err => {
        console.warn('Failed to send approval notification to user:', err.message)
    })

    return new NextResponse(
        htmlPage('Account Approved', `The account for <strong>${athlete.email}</strong> has been approved. They can now log in and use TrAIner.`),
        { status: 200, headers: { 'Content-Type': 'text/html' } }
    )
}

function htmlPage(title: string, message: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — TrAIner</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc;color:#1e293b}
.card{background:#fff;border-radius:12px;padding:2rem;max-width:420px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.1)}
h1{font-size:1.5rem;margin:0 0 .75rem}p{color:#64748b;line-height:1.5}</style></head>
<body><div class="card"><h1>${title}</h1><p>${message}</p></div></body></html>`
}
