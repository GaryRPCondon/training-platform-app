import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { GarminClient } from '@/lib/garmin/client'

export async function POST() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const garminClient = new GarminClient()
    garminClient.init(supabase, user.id)
    await garminClient.disconnect()

    return NextResponse.json({
      success: true,
      message: 'Garmin disconnected'
    })

  } catch (error: any) {
    console.error('Garmin disconnect error:', error)
    return NextResponse.json(
      { error: 'Failed to disconnect Garmin', details: error.message },
      { status: 500 }
    )
  }
}
