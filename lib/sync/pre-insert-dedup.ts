import { SupabaseClient } from '@supabase/supabase-js'
import { subHours, addHours } from 'date-fns'
import { findMergeCandidates, shouldAutoMerge } from '@/lib/activities/merge-detector'

interface ActivityData {
  start_time: string
  distance_meters: number | null
  duration_seconds: number | null
  source: string
}

interface ExistingMatch {
  id: number
  garmin_id: string | null
  strava_id: string | null
  source: string
  start_time: string
  distance_meters: number | null
  duration_seconds: number | null
  [key: string]: any
}

/**
 * Before inserting a new activity, check if a matching activity already exists.
 * Uses the same merge detection logic as post-insert merge, but prevents the duplicate
 * from being created in the first place.
 *
 * Returns the matching existing activity if found, or null if no match.
 */
export async function findExistingMatch(
  supabase: SupabaseClient,
  athleteId: string,
  activityData: ActivityData
): Promise<ExistingMatch | null> {
  const searchTime = new Date(activityData.start_time)

  // Search for activities within 12 hours of the new activity
  const { data: potentialMatches } = await supabase
    .from('activities')
    .select('*')
    .eq('athlete_id', athleteId)
    .gte('start_time', subHours(searchTime, 12).toISOString())
    .lte('start_time', addHours(searchTime, 12).toISOString())

  if (!potentialMatches || potentialMatches.length === 0) {
    return null
  }

  // Use existing merge detection logic
  const newActivityObj = {
    start_time: activityData.start_time,
    duration_seconds: activityData.duration_seconds || 0,
    distance_meters: activityData.distance_meters || 0,
    source: activityData.source,
  }

  const mergeCandidate = findMergeCandidates(newActivityObj, potentialMatches)

  if (mergeCandidate && shouldAutoMerge(mergeCandidate)) {
    return mergeCandidate.activity2 as ExistingMatch
  }

  return null
}
