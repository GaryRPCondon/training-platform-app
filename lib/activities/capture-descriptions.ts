/**
 * Description Capture for Matched Activities
 *
 * Fetches existing Strava/Garmin activity descriptions at match time so we have
 * a snapshot before any future push. Best-effort: failures are logged, not thrown.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * For each matched activity, fetch the Strava/Garmin description and store it.
 * Runs best-effort — individual failures don't affect other activities.
 */
export async function captureDescriptionsForMatches(
  supabase: SupabaseClient,
  athleteId: string,
  activityIds: number[],
): Promise<void> {
  if (activityIds.length === 0) return

  const { data: activities } = await supabase
    .from('activities')
    .select('id, garmin_id, strava_id, garmin_data, garmin_description, strava_description')
    .in('id', activityIds)
    .eq('athlete_id', athleteId)

  if (!activities || activities.length === 0) return

  const results = await Promise.allSettled(
    activities.map(activity => captureForActivity(supabase, athleteId, activity))
  )

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[Description Capture] Error:', result.reason)
    }
  }
}

async function captureForActivity(
  supabase: SupabaseClient,
  athleteId: string,
  activity: {
    id: number
    garmin_id: number | null
    strava_id: number | null
    garmin_data: any
    garmin_description: string | null
    strava_description: string | null
  },
): Promise<void> {
  const updates: Record<string, string> = {}

  // --- Garmin description ---
  if (activity.garmin_id && !activity.garmin_description) {
    // Try reading from stored garmin_data first (avoids extra API call)
    const garminData = typeof activity.garmin_data === 'string'
      ? JSON.parse(activity.garmin_data)
      : activity.garmin_data

    if (garminData?.description) {
      updates.garmin_description = garminData.description
    } else {
      // Fall back to fetching detail from Garmin API
      try {
        const { GarminClient } = await import('@/lib/garmin/client')
        const garminClient = new GarminClient()
        garminClient.init(supabase, athleteId)
        const detail = await garminClient.getActivity(activity.garmin_id)
        if (detail?.description) {
          updates.garmin_description = detail.description
        }
      } catch (error) {
        console.warn(`[Description Capture] Garmin fetch failed for activity ${activity.id}:`, error)
      }
    }
  }

  // --- Strava description ---
  if (activity.strava_id && !activity.strava_description) {
    try {
      const { StravaClient } = await import('@/lib/strava/client')
      const stravaClient = new StravaClient()
      const accessToken = await stravaClient.ensureValidToken(athleteId, supabase)
      const detail = await stravaClient.getActivity(accessToken, activity.strava_id)
      if (detail?.description) {
        updates.strava_description = detail.description
      }
    } catch (error) {
      console.warn(`[Description Capture] Strava fetch failed for activity ${activity.id}:`, error)
    }
  }

  // Update if we captured anything
  if (Object.keys(updates).length > 0) {
    await supabase
      .from('activities')
      .update(updates)
      .eq('id', activity.id)
  }
}
