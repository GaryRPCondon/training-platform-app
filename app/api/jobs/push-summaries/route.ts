// push-summaries/route.ts
//
// Triggered by Supabase pg_cron every 15 minutes.
// Scans for generated AI summaries that need pushing to Strava/Garmin.
// Push logic is NOT implemented — this is a scaffold only.
//
// TO MIGRATE TO VERCEL CRON JOBS (Pro tier):
// 1. Add to vercel.json:
//    { "crons": [{ "path": "/api/jobs/push-summaries", "schedule": "every 15 min" }] }
// 2. Replace x-cron-secret check with Vercel's authorization header check
// 3. Disable pg_cron job in Supabase:
//    SELECT cron.unschedule('push-summaries-job');

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  // Verify cron secret
  const cronSecret = request.headers.get('x-cron-secret')
  if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = await createClient()

    // Find activities with generated summaries where athlete has opted in to push
    // and the summary hasn't been pushed yet
    const { data: pendingStrava, error: stravaError } = await supabase
      .from('activities')
      .select('id, athlete_id, athletes!inner(push_summary_to_strava)')
      .eq('ai_summary_status', 'generated')
      .is('strava_summary_pushed_at', null)
      .is('strava_push_failed_at', null)
      .not('strava_id', 'is', null)

    const { data: pendingGarmin, error: garminError } = await supabase
      .from('activities')
      .select('id, athlete_id, athletes!inner(push_summary_to_garmin)')
      .eq('ai_summary_status', 'generated')
      .is('garmin_summary_pushed_at', null)
      .is('garmin_push_failed_at', null)
      .not('garmin_id', 'is', null)

    if (stravaError) console.error('[Push Job] Strava query error:', stravaError)
    if (garminError) console.error('[Push Job] Garmin query error:', garminError)

    // Filter to only athletes who have opted in
    const stravaCount = (pendingStrava || []).filter(
      (a: any) => a.athletes?.push_summary_to_strava === true
    ).length
    const garminCount = (pendingGarmin || []).filter(
      (a: any) => a.athletes?.push_summary_to_garmin === true
    ).length

    console.log(`[Push Job] Pending: ${stravaCount} Strava, ${garminCount} Garmin`)

    // TODO: Implement actual push logic in a future session
    // For each pending activity:
    //   1. Read ai_summary and garmin_description/strava_description
    //   2. Prepend ai_summary to existing description
    //   3. Call platform API to update
    //   4. Set pushed_at timestamp on success, push_failed_at on failure

    return NextResponse.json({
      success: true,
      message: 'Push logic not yet implemented',
      pending_strava: stravaCount,
      pending_garmin: garminCount,
    })
  } catch (error) {
    console.error('[Push Job] Error:', error)
    return NextResponse.json(
      { error: 'Push job failed', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
