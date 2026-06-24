import { NextResponse } from 'next/server'
import { errorMessage } from '@/lib/utils/errors'
import { createClient } from '@/lib/supabase/server'
import { GarminClient } from '@/lib/garmin/client'
import { mapGarminLapToRow } from '@/lib/garmin/lap-mapper'
import { findMergeCandidates, shouldAutoMerge } from '@/lib/activities/merge-detector'
import { findExistingMatchInMemory } from '@/lib/sync/pre-insert-dedup'
import { acquireSyncLock, releaseSyncLock } from '@/lib/sync/sync-lock'
import { format, subHours, addHours } from 'date-fns'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

const syncSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  limit: z.number().int().positive().optional(),
})

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const rawBody = await request.json()
    const parsed = syncSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const startDate = parsed.data.startDate
      ? new Date(parsed.data.startDate)
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    // Set endDate to end of day (23:59:59) to include activities throughout the entire day
    const endDate = parsed.data.endDate
      ? new Date(new Date(parsed.data.endDate).setHours(23, 59, 59, 999))
      : new Date()
    const limit = parsed.data.limit || 400  // ~1 activity/day for a year + margin for multi-activity days

    // Get athlete record
    let { data: athlete } = await supabase
      .from('athletes')
      .select('id, preferred_activity_data_source')
      .eq('id', user.id)
      .single()

    if (!athlete) {
      // Check by email (migration case)
      const { data: athleteByEmail } = await supabase
        .from('athletes')
        .select('id, preferred_activity_data_source')
        .eq('email', user.email)
        .single()

      if (athleteByEmail) {
        athlete = athleteByEmail
      } else {
        // Create new athlete
        const { data: newAthlete, error: createError } = await supabase
          .from('athletes')
          .insert({ id: user.id, email: user.email })
          .select()
          .single()

        if (createError || !newAthlete) {
          return NextResponse.json(
            { error: 'Failed to create athlete record' },
            { status: 500 }
          )
        }
        athlete = newAthlete
      }
    }

    // At this point, athlete is guaranteed to be non-null
    const athleteId = athlete!.id

    // Acquire sync lock
    const lockAcquired = await acquireSyncLock(supabase, athleteId)
    if (!lockAcquired) {
      return NextResponse.json(
        { error: 'Sync already in progress', details: 'Another sync operation is running. Please wait and try again.' },
        { status: 409 }
      )
    }

    try {
      // Initialize Garmin client
      const garminClient = new GarminClient()
      garminClient.init(supabase, athleteId)

      // Check if connected
      const { data: integration } = await supabase
        .from('athlete_integrations')
        .select('oauth1_token, oauth2_token')
        .eq('athlete_id', athleteId)
        .eq('platform', 'garmin')
        .single()

      if (!integration?.oauth1_token) {
        return NextResponse.json({
          error: 'Garmin not connected',
          details: 'Please connect Garmin in your profile settings'
        }, { status: 401 })
      }

      // Fetch activities
      console.log(`Garmin sync: Fetching activities from ${format(startDate, 'yyyy-MM-dd')} to ${format(endDate, 'yyyy-MM-dd')}`)

      const garminActivities = await garminClient.getActivities(startDate, endDate, limit)

      console.log(`Garmin sync: Fetched ${garminActivities.length} activities`)

      let syncedCount = 0
      let mergedCount = 0
      let pendingReviewCount = 0
      let skippedCount = 0
      let totalLapsInserted = 0
      let backfillCount = 0

      if (garminActivities.length === 0) {
        return NextResponse.json({
          success: true,
          message: 'No activities found in date range',
          synced: 0,
          merged: 0,
          pendingReview: 0,
          skipped: 0
        })
      }

      // --- Batch reads: replace the per-activity existence + dedup + merge
      // queries (the N+1) with two queries for the whole batch. ---

      // 1) Which of these Garmin activities already exist locally.
      const garminIdStrs = garminActivities.map(a => a.activityId.toString())
      const existingByGarminId = new Map<string, { id: number; has_detail_data: boolean | null }>()
      for (let i = 0; i < garminIdStrs.length; i += 200) {
        const chunk = garminIdStrs.slice(i, i + 200)
        const { data: existingRows } = await supabase
          .from('activities')
          .select('id, garmin_id, has_detail_data')
          .eq('athlete_id', athleteId)
          .in('garmin_id', chunk)
        for (const row of existingRows ?? []) {
          // garmin_id is bigint → comes back as a JS number; normalise the map
          // key to a string so it matches activity.activityId.toString() below.
          if (row.garmin_id != null) existingByGarminId.set(String(row.garmin_id), { id: row.id, has_detail_data: row.has_detail_data })
        }
      }

      // 2) One wide candidate window for dedup + merge detection. Held in memory
      // and mutated as we merge (set garmin_id / drop deleted rows) so later
      // activities see the same state a re-query would have.
      const startMs = garminActivities.map(a => new Date(a.startTimeLocal).getTime())
      const windowStart = subHours(new Date(Math.min(...startMs)), 12).toISOString()
      const windowEnd = addHours(new Date(Math.max(...startMs)), 12).toISOString()
      const { data: windowRows } = await supabase
        .from('activities')
        .select('*')
        .eq('athlete_id', athleteId)
        .gte('start_time', windowStart)
        .lte('start_time', windowEnd)
      const windowActivities = windowRows ?? []

      // Process activities
      for (const activity of garminActivities) {
        const activityIdStr = activity.activityId.toString()

        // Check if already exists (from the batch existence map)
        const existing = existingByGarminId.get(activityIdStr)

        if (existing) {
          // Backfill lap detail for existing activities that were synced before this feature existed
          // Cap at 10 activities per sync run (= ~20 extra API calls) to stay within rate limits
          if (!existing.has_detail_data && backfillCount < 10) {
            console.log(`Backfilling lap detail for existing activity ${existing.id}`)
            const { lapsInserted } = await fetchAndStoreLapDetail(
              activity.activityId, existing.id, garminClient, supabase
            )
            totalLapsInserted += lapsInserted
            backfillCount++
          } else {
            console.log(`Garmin activity ${activityIdStr} already exists (ID: ${existing.id}), skipping`)
          }
          skippedCount++
          continue
        }

        // Map activity type
        const activityType = mapGarminActivityType(activity.activityType?.typeKey)

        // Prepare activity data
        const activityData = {
          athlete_id: athleteId,
          garmin_id: activityIdStr,
          source: 'garmin' as const,
          activity_name: activity.activityName,
          activity_type: activityType,
          start_time: activity.startTimeLocal,
          distance_meters: activity.distance,
          duration_seconds: activity.elapsedDuration || activity.duration,
          moving_duration_seconds: activity.movingDuration,
          elevation_gain_meters: activity.elevationGain,
          elevation_loss_meters: activity.elevationLoss,
          avg_hr: activity.averageHR,
          max_hr: activity.maxHR,
          calories: activity.calories,
          avg_cadence: activity.averageRunningCadenceInStepsPerMinute,
          max_cadence: activity.maxRunningCadenceInStepsPerMinute,
          garmin_data: {
            aerobicTrainingEffect: activity.aerobicTrainingEffect,
            anaerobicTrainingEffect: activity.anaerobicTrainingEffect,
            trainingEffectLabel: activity.trainingEffectLabel,
            activityTrainingLoad: activity.activityTrainingLoad,
            deviceId: activity.deviceId,
            eventType: activity.eventType?.typeKey,
            steps: activity.steps,
            description: activity.description || null,
          },
          synced_from_garmin: new Date().toISOString()
        }

        // Pre-insert dedup: check if a matching activity from another source already exists
        const existingMatch = findExistingMatchInMemory(windowActivities, {
          start_time: activity.startTimeLocal,
          distance_meters: activity.distance,
          duration_seconds: activity.elapsedDuration || activity.duration,
          source: 'garmin',
        })

        if (existingMatch && !existingMatch.garmin_id) {
          // Merge into existing activity instead of inserting
          console.log(`Pre-insert dedup: Merging Garmin ${activityIdStr} into existing activity ${existingMatch.id}`)

          const preference = athlete?.preferred_activity_data_source || 'most_recent'
          const shouldUpdateDetails = preference === 'garmin' || preference === 'most_recent'

          const updateData: Record<string, unknown> = {
            garmin_id: activityIdStr,
            synced_from_garmin: new Date().toISOString(),
            source: 'merged',
            garmin_data: activityData.garmin_data,
          }

          if (shouldUpdateDetails) {
            updateData.activity_name = activity.activityName
            updateData.activity_type = activityData.activity_type
          }

          const { error: updateError } = await supabase
            .from('activities')
            .update(updateData)
            .eq('id', existingMatch.id)

          if (!updateError) {
            console.log(`Pre-insert merged into existing activity ${existingMatch.id}`)
            mergedCount++
            // Reflect the merge in the in-memory window so this row is no longer
            // an available merge target for later activities in the batch, and
            // mark the garmin_id as present so an intra-batch duplicate skips.
            existingMatch.garmin_id = activityIdStr
            existingMatch.source = 'merged'
            existingByGarminId.set(activityIdStr, { id: existingMatch.id, has_detail_data: true })
            const { lapsInserted } = await fetchAndStoreLapDetail(
              activity.activityId, existingMatch.id, garminClient, supabase
            )
            totalLapsInserted += lapsInserted
          } else {
            console.error('Pre-insert merge failed:', updateError)
          }
          continue
        }

        // Insert activity
        const { data: inserted, error: insertError } = await supabase
          .from('activities')
          .insert(activityData)
          .select()
          .single()

        if (insertError) {
          console.error('Failed to insert Garmin activity:', insertError)
          continue
        }

        console.log(`Synced Garmin activity ${activityIdStr} -> DB ID ${inserted.id}`)
        syncedCount++
        // Track within this batch so a duplicate of the same activity later in
        // the same fetch is skipped (the old per-activity re-query did this).
        existingByGarminId.set(activityIdStr, { id: inserted.id, has_detail_data: true })

        const { lapsInserted: newLaps } = await fetchAndStoreLapDetail(
          activity.activityId, inserted.id, garminClient, supabase
        )
        totalLapsInserted += newLaps

        // Check for merge candidates (fallback for edge cases not caught by pre-insert dedup).
        // Filter the in-memory window instead of re-querying.
        const searchMs = new Date(activity.startTimeLocal).getTime()
        const lo = subHours(new Date(searchMs), 12).getTime()
        const hi = addHours(new Date(searchMs), 12).getTime()
        const potentialMatches = windowActivities.filter(a => {
          if (a.source === 'garmin' || a.garmin_id != null) return false
          const t = new Date(a.start_time).getTime()
          return t >= lo && t <= hi
        })

        if (potentialMatches && potentialMatches.length > 0) {
          console.log(`Found ${potentialMatches.length} potential merge matches`)

          const newActivityObj = {
            ...inserted,
            start_time: activity.startTimeLocal,
            duration_seconds: activity.elapsedDuration || activity.duration,
            distance_meters: activity.distance,
            source: 'garmin'
          }

          const mergeCandidate = findMergeCandidates(newActivityObj, potentialMatches)

          if (mergeCandidate) {
            console.log(`Merge candidate: ${mergeCandidate.activity2.id} (confidence: ${mergeCandidate.confidence})`)

            if (shouldAutoMerge(mergeCandidate)) {
              if (mergeCandidate.activity2.id! < inserted.id) {
                // Delete newly inserted, update existing
                await supabase.from('activities').delete().eq('id', inserted.id)

                // Respect user's data priority preference
                const preference = athlete?.preferred_activity_data_source || 'most_recent'
                const shouldUpdateDetails = preference === 'garmin' || preference === 'most_recent'

                const updateData: Record<string, unknown> = {
                  garmin_id: activityIdStr,
                  synced_from_garmin: new Date().toISOString(),
                  source: 'merged',
                  garmin_data: activityData.garmin_data
                }

                // Only update activity name/type if preference allows
                if (shouldUpdateDetails) {
                  updateData.activity_name = activity.activityName
                  updateData.activity_type = activityData.activity_type
                }

                const { error: updateError } = await supabase
                  .from('activities')
                  .update(updateData)
                  .eq('id', mergeCandidate.activity2.id)

                if (!updateError) {
                  console.log(`Merged into existing activity ${mergeCandidate.activity2.id}`)
                  mergedCount++
                  syncedCount-- // Adjust count since we deleted
                  // Reflect the merge in the in-memory window so the row is no
                  // longer an available merge target for later activities.
                  const merged = windowActivities.find(a => a.id === mergeCandidate.activity2.id)
                  if (merged) {
                    merged.garmin_id = activityIdStr
                    merged.source = 'merged'
                  }
                  existingByGarminId.set(activityIdStr, { id: mergeCandidate.activity2.id!, has_detail_data: true })
                  const { lapsInserted: mergeLaps } = await fetchAndStoreLapDetail(
                    activity.activityId, mergeCandidate.activity2.id!, garminClient, supabase
                  )
                  totalLapsInserted += mergeLaps
                }
              }
            } else {
              // Low confidence - flag for review
              await supabase.from('workout_flags').insert({
                athlete_id: athleteId,
                activity_id: inserted.id,
                flag_type: 'merge_candidate',
                severity: 'info',
                flag_data: {
                  potential_match_id: mergeCandidate.activity2.id,
                  confidence: mergeCandidate.confidence,
                  confidence_score: mergeCandidate.confidenceScore
                }
              })
              pendingReviewCount++
            }
          }
        }
      }

      // Update last synced timestamp
      await supabase
        .from('athlete_integrations')
        .update({ last_synced_at: new Date().toISOString() })
        .eq('athlete_id', athleteId)
        .eq('platform', 'garmin')

      return NextResponse.json({
        success: true,
        message: 'Garmin sync completed',
        synced: syncedCount,
        merged: mergedCount,
        pendingReview: pendingReviewCount,
        skipped: skippedCount,
        lapsInserted: totalLapsInserted
      })
    } finally {
      // Always release sync lock
      await releaseSyncLock(supabase, athleteId)
    }

  } catch (error: unknown) {
    console.error('Garmin sync error:', error)
    return NextResponse.json(
      { error: 'Failed to sync with Garmin', details: errorMessage(error) },
      { status: 500 }
    )
  }
}

/**
 * Fetch and store per-lap splits + HR zones for a Garmin activity.
 * Non-fatal: any error is logged and the function returns lapsInserted = 0.
 */
async function fetchAndStoreLapDetail(
  garminActivityId: number,
  dbActivityId: number,
  garminClient: GarminClient,
  supabase: SupabaseClient
): Promise<{ lapsInserted: number }> {
  let lapsInserted = 0
  try {
    // Fetch splits — preferred over splitSummaries (has wktStepIndex, intensityType, complianceScore)
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

    // Fetch HR zones
    const hrZones = await garminClient.getActivityHRZones(garminActivityId)

    // Update activity record with detail metadata
    await supabase
      .from('activities')
      .update({
        has_detail_data: true,
        ...(hrZones ? { hr_zones: hrZones } : {})
      })
      .eq('id', dbActivityId)

  } catch (err) {
    // Non-fatal: activity summary is still saved
    console.error(`Detail fetch failed for Garmin activity ${garminActivityId}:`, err)
  }
  return { lapsInserted }
}

/**
 * Map Garmin activity type to normalized type
 */
function mapGarminActivityType(typeKey: string | undefined): string {
  if (!typeKey) return 'other'

  const mapping: Record<string, string> = {
    'running': 'running',
    'trail_running': 'running',
    'treadmill_running': 'running',
    'track_running': 'running',
    'indoor_running': 'running',
    'street_running': 'running',
    'virtual_run': 'running',
    'obstacle_run': 'running',
    'ultra_run': 'running',
    'cycling': 'cycling',
    'mountain_biking': 'cycling',
    'indoor_cycling': 'cycling',
    'virtual_ride': 'cycling',
    'swimming': 'swimming',
    'pool_swimming': 'swimming',
    'open_water_swimming': 'swimming',
    'walking': 'walking',
    'hiking': 'hiking',
    'strength_training': 'strength',
    'yoga': 'yoga',
    'elliptical': 'elliptical',
    'stair_stepping': 'stair_stepping',
    'rowing': 'rowing',
    'indoor_rowing': 'rowing'
  }

  return mapping[typeKey.toLowerCase()] || typeKey.toLowerCase()
}
