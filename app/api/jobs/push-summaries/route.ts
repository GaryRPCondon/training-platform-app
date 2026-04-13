// push-summaries/route.ts
//
// Triggered by Supabase pg_cron every 15 minutes.
// Scans for generated AI summaries that need pushing to Strava/Garmin.
//
// TO MIGRATE TO VERCEL CRON JOBS (Pro tier):
// 1. Add to vercel.json:
//    { "crons": [{ "path": "/api/jobs/push-summaries", "schedule": "every 15 min" }] }
// 2. Replace x-cron-secret check with Vercel's authorization header check
// 3. Disable pg_cron job in Supabase:
//    SELECT cron.unschedule('push-summaries-job');

import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { StravaClient } from '@/lib/strava/client'
import { GarminClient } from '@/lib/garmin/client'

function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

function buildDescription(ratingPrefix: string, aiSummary: string, existingDescription: string | null): string {
  const header = `trAIner Summary: ${ratingPrefix}${aiSummary}`
  if (!existingDescription) return header
  return `${header}\n\n---\n\n${existingDescription}`
}

interface PendingActivity {
  id: string
  athlete_id: string
  ai_summary: string
  strava_id: string | null
  garmin_id: string | null
  strava_description: string | null
  garmin_description: string | null
  ai_star_rating: number | null
}

export async function POST(request: Request) {
  // Verify cron secret
  const cronSecret = request.headers.get('x-cron-secret')
  if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const results = { strava: { pushed: 0, failed: 0 }, garmin: { pushed: 0, failed: 0 } }

  try {
    // Find activities with generated summaries where push hasn't happened yet
    // and athlete has opted in. Query both platforms in one go.
    const { data: pendingStrava, error: stravaError } = await supabase
      .from('activities')
      .select('id, athlete_id, ai_summary, ai_star_rating, strava_id, strava_description, athletes!inner(push_summary_to_strava)')
      .eq('ai_summary_status', 'generated')
      .is('strava_summary_pushed_at', null)
      .is('strava_push_failed_at', null)
      .not('strava_id', 'is', null)
      .not('ai_summary', 'is', null)

    const { data: pendingGarmin, error: garminError } = await supabase
      .from('activities')
      .select('id, athlete_id, ai_summary, ai_star_rating, garmin_id, garmin_description, athletes!inner(push_summary_to_garmin)')
      .eq('ai_summary_status', 'generated')
      .is('garmin_summary_pushed_at', null)
      .is('garmin_push_failed_at', null)
      .not('garmin_id', 'is', null)
      .not('ai_summary', 'is', null)

    if (stravaError) console.error('[Push Job] Strava query error:', stravaError)
    if (garminError) console.error('[Push Job] Garmin query error:', garminError)

    // Filter to opted-in athletes
    const stravaActivities = (pendingStrava || []).filter(
      (a: any) => a.athletes?.push_summary_to_strava === true
    ) as unknown as PendingActivity[]
    const garminActivities = (pendingGarmin || []).filter(
      (a: any) => a.athletes?.push_summary_to_garmin === true
    ) as unknown as PendingActivity[]

    console.log(`[Push Job] Pending: ${stravaActivities.length} Strava, ${garminActivities.length} Garmin`)

    // ── Push to Strava ──
    // Group by athlete so we only refresh tokens once per athlete
    const stravaByAthlete = new Map<string, PendingActivity[]>()
    for (const a of stravaActivities) {
      const list = stravaByAthlete.get(a.athlete_id) || []
      list.push(a)
      stravaByAthlete.set(a.athlete_id, list)
    }

    for (const [athleteId, activities] of stravaByAthlete) {
      try {
        const strava = new StravaClient()
        const accessToken = await strava.ensureValidToken(athleteId, supabase)

        for (const activity of activities) {
          try {
            const ratingPrefix = activity.ai_star_rating != null
              ? `⭐ ${activity.ai_star_rating}/5 — `
              : ''
            const description = buildDescription(ratingPrefix, activity.ai_summary, activity.strava_description)
            await strava.updateActivityDescription(accessToken, Number(activity.strava_id), description)

            await supabase
              .from('activities')
              .update({ strava_summary_pushed_at: new Date().toISOString() })
              .eq('id', activity.id)

            results.strava.pushed++
            console.log(`[Push Job] Pushed to Strava: activity ${activity.id}`)
          } catch (error) {
            console.error(`[Push Job] Strava push failed for activity ${activity.id}:`, error instanceof Error ? error.message : error)
            await supabase
              .from('activities')
              .update({ strava_push_failed_at: new Date().toISOString() })
              .eq('id', activity.id)
            results.strava.failed++
          }
        }
      } catch (error) {
        console.error(`[Push Job] Strava token error for athlete ${athleteId}:`, error instanceof Error ? error.message : error)
        // Mark all activities for this athlete as failed
        for (const activity of activities) {
          await supabase
            .from('activities')
            .update({ strava_push_failed_at: new Date().toISOString() })
            .eq('id', activity.id)
          results.strava.failed++
        }
      }
    }

    // ── Push to Garmin ──
    const garminByAthlete = new Map<string, PendingActivity[]>()
    for (const a of garminActivities) {
      const list = garminByAthlete.get(a.athlete_id) || []
      list.push(a)
      garminByAthlete.set(a.athlete_id, list)
    }

    for (const [athleteId, activities] of garminByAthlete) {
      try {
        const garmin = new GarminClient()
        garmin.init(supabase, athleteId)

        for (const activity of activities) {
          try {
            const ratingPrefix = activity.ai_star_rating != null
              ? `⭐ ${activity.ai_star_rating}/5 — `
              : ''
            const description = buildDescription(ratingPrefix, activity.ai_summary, activity.garmin_description)
            await garmin.updateActivityDescription(Number(activity.garmin_id), description)

            await supabase
              .from('activities')
              .update({ garmin_summary_pushed_at: new Date().toISOString() })
              .eq('id', activity.id)

            results.garmin.pushed++
            console.log(`[Push Job] Pushed to Garmin: activity ${activity.id}`)
          } catch (error) {
            console.error(`[Push Job] Garmin push failed for activity ${activity.id}:`, error instanceof Error ? error.message : error)
            await supabase
              .from('activities')
              .update({ garmin_push_failed_at: new Date().toISOString() })
              .eq('id', activity.id)
            results.garmin.failed++
          }
        }
      } catch (error) {
        console.error(`[Push Job] Garmin auth error for athlete ${athleteId}:`, error instanceof Error ? error.message : error)
        for (const activity of activities) {
          await supabase
            .from('activities')
            .update({ garmin_push_failed_at: new Date().toISOString() })
            .eq('id', activity.id)
          results.garmin.failed++
        }
      }
    }

    console.log(`[Push Job] Complete:`, results)

    return NextResponse.json({
      success: true,
      ...results,
    })
  } catch (error) {
    console.error('[Push Job] Error:', error)
    return NextResponse.json(
      { error: 'Push job failed', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
