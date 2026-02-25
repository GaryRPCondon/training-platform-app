import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { GarminClient } from '@/lib/garmin/client'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Attempt a live API call — let ensureAuthenticated() determine if connected
    const garminClient = new GarminClient()
    garminClient.init(supabase, user.id)
    const profile = await garminClient.getUserProfile()

    // Fetch last_synced_at separately (best-effort)
    const { data: integration } = await supabase
      .from('athlete_integrations')
      .select('last_synced_at')
      .eq('athlete_id', user.id)
      .single()

    return NextResponse.json({
      connected: true,
      displayName: profile.displayName ?? profile.fullName ?? null,
      lastSynced: integration?.last_synced_at ?? null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ connected: false, error: message }, { status: 200 })
  }
}
