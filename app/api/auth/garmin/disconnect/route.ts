import { NextResponse } from 'next/server'
import { errorMessage } from '@/lib/utils/errors'
import { createClient } from '@/lib/supabase/server'
import { GarminClient } from '@/lib/garmin/client'
import { isDemoUser } from '@/lib/demo/demo'

export async function POST() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Self-guard: public route — the demo account has no integrations to touch.
    if (isDemoUser(user.id)) {
      return NextResponse.json({ error: 'demo_restricted' }, { status: 403 })
    }

    const garminClient = new GarminClient()
    garminClient.init(supabase, user.id)
    await garminClient.disconnect()

    return NextResponse.json({
      success: true,
      message: 'Garmin disconnected'
    })

  } catch (error: unknown) {
    console.error('Garmin disconnect error:', error)
    return NextResponse.json(
      { error: 'Failed to disconnect Garmin', details: errorMessage(error) },
      { status: 500 }
    )
  }
}
