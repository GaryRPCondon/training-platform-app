import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { StravaClient } from '@/lib/strava/client'

export async function POST() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Revoke Strava access token (best effort)
    const strava = new StravaClient()
    const tokens = await strava.getTokens(user.id, supabase)
    if (tokens?.access_token) {
      try {
        await fetch('https://www.strava.com/oauth/deauthorize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `access_token=${tokens.access_token}`,
        })
      } catch {
        // Best effort — continue with local cleanup even if revoke fails
      }
    }

    // Remove integration record
    await supabase
      .from('athlete_integrations')
      .delete()
      .eq('athlete_id', user.id)
      .eq('platform', 'strava')

    // Update athlete flag
    await supabase
      .from('athletes')
      .update({ strava_connected: false })
      .eq('id', user.id)

    return NextResponse.json({
      success: true,
      message: 'Strava disconnected',
    })
  } catch (error: any) {
    console.error('Strava disconnect error:', error)
    return NextResponse.json(
      { error: 'Failed to disconnect Strava', details: error.message },
      { status: 500 },
    )
  }
}
