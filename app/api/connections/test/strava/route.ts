import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { StravaClient } from '@/lib/strava/client'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const stravaClient = new StravaClient()
    let accessToken: string
    try {
      accessToken = await stravaClient.ensureValidToken(user.id, supabase)
    } catch {
      return NextResponse.json({ connected: false, error: 'Strava not connected' }, { status: 200 })
    }

    // Fetch Strava athlete profile
    const res = await fetch('https://www.strava.com/api/v3/athlete', {
      headers: { Authorization: `Bearer ${accessToken}` }
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return NextResponse.json({ connected: false, error: err.message ?? `Strava API error ${res.status}` }, { status: 200 })
    }

    const athlete = await res.json()

    // Also grab last_synced_at
    const { data: integration } = await supabase
      .from('athlete_integrations')
      .select('token_expires_at, last_synced_at')
      .eq('athlete_id', user.id)
      .eq('platform', 'strava')
      .single()

    return NextResponse.json({
      connected: true,
      displayName: `${athlete.firstname ?? ''} ${athlete.lastname ?? ''}`.trim() || null,
      username: athlete.username ?? null,
      tokenExpiresAt: integration?.token_expires_at ?? null,
      lastSynced: integration?.last_synced_at ?? null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ connected: false, error: message }, { status: 200 })
  }
}
