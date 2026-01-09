import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { GarminClient } from '@/lib/garmin/client'
import { findMergeCandidates, shouldAutoMerge } from '@/lib/activities/merge-detector'
import { format, subHours, addHours } from 'date-fns'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const startDate = body.startDate
      ? new Date(body.startDate)
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    // Set endDate to end of day (23:59:59) to include activities throughout the entire day
    const endDate = body.endDate
      ? new Date(new Date(body.endDate).setHours(23, 59, 59, 999))
      : new Date()
    const limit = body.limit || 400  // ~1 activity/day for a year + margin for multi-activity days

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

    // Process activities
    for (const activity of garminActivities) {
      const activityIdStr = activity.activityId.toString()

      // Check if already exists
      const { data: existing } = await supabase
        .from('activities')
        .select('id, source')
        .eq('athlete_id', athleteId)
        .eq('garmin_id', activityIdStr)
        .single()

      if (existing) {
        console.log(`Garmin activity ${activityIdStr} already exists (ID: ${existing.id}), skipping`)
        skippedCount++
        continue
      }

      // Map activity type
      const activityType = mapGarminActivityType(activity.activityType?.typeKey)

      // Prepare activity data
      const activityData = {
        athlete_id: athleteId,
        garmin_id: activityIdStr,
        source: 'garmin',
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
          steps: activity.steps
        },
        synced_from_garmin: new Date().toISOString()
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

      // Check for merge candidates
      const searchStartTime = new Date(activity.startTimeLocal)

      const { data: potentialMatches } = await supabase
        .from('activities')
        .select('*')
        .eq('athlete_id', athleteId)
        .neq('source', 'garmin')
        .is('garmin_id', null)
        .gte('start_time', subHours(searchStartTime, 12).toISOString())
        .lte('start_time', addHours(searchStartTime, 12).toISOString())

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

              const updateData: any = {
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
      skipped: skippedCount
    })

  } catch (error: any) {
    console.error('Garmin sync error:', error)
    return NextResponse.json(
      { error: 'Failed to sync with Garmin', details: error.message },
      { status: 500 }
    )
  }
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
