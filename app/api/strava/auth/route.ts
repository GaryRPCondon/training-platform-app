import { NextResponse } from 'next/server'
import { StravaClient } from '@/lib/strava/client'

export async function GET() {
    const client = new StravaClient()

    const state = crypto.randomUUID()
    const url = client.getAuthorizationUrl(state)

    const response = NextResponse.redirect(url)

    // Store state in a short-lived httpOnly cookie for CSRF verification in the callback
    response.cookies.set('strava_oauth_state', state, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 600, // 10 minutes
        path: '/',
    })

    return response
}
