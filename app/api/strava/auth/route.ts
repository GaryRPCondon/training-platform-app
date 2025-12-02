import { NextResponse } from 'next/server'
import { StravaClient } from '@/lib/strava/client'

export async function GET(request: Request) {
    const client = new StravaClient()

    // Generate state for CSRF protection
    // In a production app, store this in a secure httpOnly cookie and verify in callback
    const state = Math.random().toString(36).substring(7)

    const url = client.getAuthorizationUrl(state)

    return NextResponse.redirect(url)
}
