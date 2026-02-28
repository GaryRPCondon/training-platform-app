import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { GarminClient } from '@/lib/garmin/client'
import { mapGarminLapToRow } from '@/lib/garmin/lap-mapper'
import type { SupabaseClient } from '@supabase/supabase-js'

export async function POST() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Only backfill last 90 days — older activities aren't needed for AI coach context
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

    const { data: activities, error } = await supabase
      .from('activities')
      .select('id, garmin_id')
      .eq('athlete_id', user.id)
      .or('has_detail_data.is.null,has_detail_data.eq.false')
      .not('garmin_id', 'is', null)
      .gte('start_time', ninetyDaysAgo)
      .order('id', { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!activities?.length) {
      return NextResponse.json({ success: true, message: 'Nothing to backfill', processed: 0, lapsInserted: 0 })
    }

    const garminClient = new GarminClient()
    garminClient.init(supabase, user.id)

    let processed = 0
    let lapsInserted = 0
    const errors: string[] = []

    for (const activity of activities) {
      try {
        const garminId = Number(activity.garmin_id)
        const { lapsInserted: n } = await backfillOne(garminId, activity.id, garminClient, supabase)
        lapsInserted += n
        processed++
        console.log(`Backfilled activity ${activity.id} (Garmin ${garminId}): ${n} laps`)
      } catch (err: any) {
        console.error(`Failed to backfill activity ${activity.id}:`, err)
        errors.push(`activity ${activity.id}: ${err.message}`)
      }
      // 2 API calls per activity → stay well under 60/min limit
      await new Promise(resolve => setTimeout(resolve, 2000))
    }

    return NextResponse.json({
      success: true,
      processed,
      lapsInserted,
      ...(errors.length ? { errors } : {})
    })

  } catch (error: any) {
    console.error('Backfill error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

async function backfillOne(
  garminActivityId: number,
  dbActivityId: number,
  garminClient: GarminClient,
  supabase: SupabaseClient
): Promise<{ lapsInserted: number }> {
  let lapsInserted = 0

  const splitsData = await garminClient.getActivitySplits(garminActivityId)

  if (splitsData?.lapDTOs?.length) {
    const lapRows = splitsData.lapDTOs.map((lap: unknown) =>
      mapGarminLapToRow(dbActivityId, lap as Record<string, unknown>)
    )
    const { error } = await supabase
      .from('laps')
      .upsert(lapRows, { onConflict: 'activity_id,lap_index' })
    if (!error) lapsInserted = lapRows.length
    else console.error(`Lap upsert failed for activity ${dbActivityId}:`, error)
  }

  const hrZones = await garminClient.getActivityHRZones(garminActivityId)

  await supabase
    .from('activities')
    .update({
      has_detail_data: true,
      ...(hrZones ? { hr_zones: hrZones } : {})
    })
    .eq('id', dbActivityId)

  return { lapsInserted }
}
