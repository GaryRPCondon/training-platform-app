import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { findMergeCandidates, shouldAutoMerge } from '@/lib/activities/merge-detector'
import { findExistingMatchInMemory } from '@/lib/sync/pre-insert-dedup'
import { acquireSyncLock, releaseSyncLock } from '@/lib/sync/sync-lock'
import { format, subHours, addHours } from 'date-fns'
import { z } from 'zod'

const syncSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
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

        const startDate = parsed.data.startDate || format(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd')
        const endDate = parsed.data.endDate || format(new Date(), 'yyyy-MM-dd')
        const limit = parsed.data.limit // Optional limit for number of activities

        // Ensure athlete record exists - check by ID first
        let { data: athlete } = await supabase
            .from('athletes')
            .select('id, preferred_activity_data_source')
            .eq('id', user.id)
            .single()

        if (!athlete) {
            // Check if athlete exists with this email but different ID
            const { data: athleteByEmail } = await supabase
                .from('athletes')
                .select('id, preferred_activity_data_source')
                .eq('email', user.email)
                .single()

            if (athleteByEmail) {
                console.log('Found existing athlete by email:', athleteByEmail.id, '- Using this athlete ID')
                athlete = athleteByEmail
            } else {
                console.log('Creating athlete record for user:', user.id)
                const { data: newAthlete, error: athleteCreateError } = await supabase
                    .from('athletes')
                    .insert({
                        id: user.id,
                        email: user.email,
                        created_at: new Date().toISOString()
                    })
                    .select()
                    .single()

                if (athleteCreateError) {
                    console.error('Failed to create athlete:', athleteCreateError)
                    return NextResponse.json({
                        error: 'Failed to create athlete record',
                        details: athleteCreateError.message
                    }, { status: 500 })
                }
                console.log('Athlete record created:', newAthlete)
                athlete = newAthlete
            }
        } else {
            console.log('Athlete record exists:', athlete.id)
        }

        if (!athlete) {
            throw new Error('Failed to resolve athlete record')
        }

        const athleteId = athlete.id

        // Acquire sync lock
        const lockAcquired = await acquireSyncLock(supabase, athleteId)
        if (!lockAcquired) {
            return NextResponse.json(
                { error: 'Sync already in progress', details: 'Another sync operation is running. Please wait and try again.' },
                { status: 409 }
            )
        }

        try {
            // Initialize Strava Client
            const { StravaClient } = await import('@/lib/strava/client')
            const stravaClient = new StravaClient()

            // Ensure we have a valid token
            let accessToken: string
            try {
                accessToken = await stravaClient.ensureValidToken(athleteId, supabase)
            } catch (tokenError) {
                console.error('Strava token error:', tokenError)
                return NextResponse.json({
                    error: 'Strava not connected or token expired',
                    details: 'Please connect Strava in your profile settings'
                }, { status: 401 })
            }

            // Convert dates to Unix timestamps for Strava API
            const after = Math.floor(new Date(startDate).getTime() / 1000)
            const before = Math.floor(new Date(endDate).getTime() / 1000) + 86400 // Add 1 day to include end date

            console.log(`Fetching Strava activities from ${startDate} to ${endDate} (limit: ${limit || 'default'})`)

            let stravaActivities: any[] = []
            let page = 1
            const PER_PAGE = 200 // Maximize efficiency
            let keepFetching = true

            while (keepFetching) {
                // Check if we've reached the global limit
                if (limit && stravaActivities.length >= limit) {
                    console.log(`Reached limit of ${limit} activities`)
                    break
                }

                // Calculate remaining items if limit is set
                const remainingLimit = limit ? limit - stravaActivities.length : undefined
                // Don't request more than needed if we're close to the limit
                const currentPerPage = remainingLimit ? Math.min(remainingLimit, PER_PAGE) : PER_PAGE

                console.log(`Fetching page ${page} (per_page: ${currentPerPage})...`)

                const pageActivities = await stravaClient.getActivities(accessToken, {
                    after,
                    before,
                    per_page: currentPerPage,
                    page: page
                })

                if (!pageActivities || pageActivities.length === 0) {
                    keepFetching = false
                } else {
                    stravaActivities = [...stravaActivities, ...pageActivities]
                    console.log(`Fetched ${pageActivities.length} activities on page ${page}`)

                    // If we got fewer than requested, we've reached the end
                    if (pageActivities.length < currentPerPage) {
                        keepFetching = false
                    }

                    page++
                }
            }

            console.log('Strava sync - Date range:', startDate, 'to', endDate)
            console.log('Strava sync - Total fetched activities:', stravaActivities.length)
            console.log('Strava sync - Sample activity:', stravaActivities?.[0])

            let syncedCount = 0
            let mergedCount = 0
            let pendingReviewCount = 0

            if (!stravaActivities || !Array.isArray(stravaActivities)) {
                console.error('Invalid response from Strava bridge:', stravaActivities)
                return NextResponse.json({
                    success: true,
                    message: 'No activities returned from Strava bridge',
                    synced: 0,
                    merged: 0,
                    pendingReview: 0
                })
            }

            console.log(`Processing ${stravaActivities.length} activities...`)

            const activitiesToProcess = stravaActivities

            // --- Batch reads: replace the per-activity existence + dedup + merge
            // queries (the N+1) with two queries for the whole batch. ---

            // 1) Which of these Strava activities already exist locally.
            const stravaIdStrs = activitiesToProcess
                .map(a => a.id?.toString())
                .filter((s): s is string => !!s)
            const existingStravaIds = new Set<string>()
            for (let i = 0; i < stravaIdStrs.length; i += 200) {
                const chunk = stravaIdStrs.slice(i, i + 200)
                const { data: existingRows } = await supabase
                    .from('activities')
                    .select('strava_id')
                    .eq('athlete_id', athleteId)
                    .in('strava_id', chunk)
                for (const row of existingRows ?? []) {
                    if (row.strava_id) existingStravaIds.add(row.strava_id)
                }
            }

            // 2) One wide candidate window for dedup + merge detection. Held in
            // memory and mutated as we merge so later activities see the same
            // state a re-query would have.
            const startMs = activitiesToProcess
                .map(a => new Date(a.start_date).getTime())
                .filter(t => !Number.isNaN(t))
            const windowStart = subHours(new Date(startMs.length ? Math.min(...startMs) : Date.now()), 12).toISOString()
            const windowEnd = addHours(new Date(startMs.length ? Math.max(...startMs) : Date.now()), 12).toISOString()
            const { data: windowRows } = await supabase
                .from('activities')
                .select('*')
                .eq('athlete_id', athleteId)
                .gte('start_time', windowStart)
                .lte('start_time', windowEnd)
            const windowActivities: any[] = windowRows ?? []

            for (const activity of activitiesToProcess) {
                console.log('Processing Strava activity:', {
                    id: activity.id,
                    name: activity.name,
                    start_date: activity.start_date,
                    moving_time: activity.moving_time,
                    distance: activity.distance
                })

                // Check if this Strava activity already exists (from the batch set)
                const stravaIdStr = activity.id?.toString()
                if (stravaIdStr && existingStravaIds.has(stravaIdStr)) {
                    console.log(`Strava activity ${activity.id} already exists, skipping`)
                    continue
                }

                // Pre-insert dedup: check if a matching activity from another source already exists
                const existingMatch = findExistingMatchInMemory(windowActivities, {
                    start_time: activity.start_date,
                    distance_meters: activity.distance,
                    duration_seconds: activity.elapsed_time,
                    source: 'strava',
                })

                if (existingMatch && !existingMatch.strava_id) {
                    // Merge into existing activity instead of inserting
                    console.log(`Pre-insert dedup: Merging Strava ${activity.id} into existing activity ${existingMatch.id}`)

                    const preference = athlete?.preferred_activity_data_source || 'most_recent'
                    const shouldUpdateDetails = preference === 'strava' || preference === 'most_recent'

                    const updateData: any = {
                        strava_id: activity.id?.toString(),
                        synced_from_strava: new Date().toISOString(),
                        source: 'merged',
                        strava_data: {
                            workout_type: activity.workout_type,
                            sport_type: activity.sport_type,
                            trainer: activity.trainer,
                            commute: activity.commute
                        },
                    }

                    if (shouldUpdateDetails) {
                        updateData.activity_name = activity.name
                        updateData.activity_type = activity.type
                    }

                    const { error: updateError } = await supabase
                        .from('activities')
                        .update(updateData)
                        .eq('id', existingMatch.id)

                    if (!updateError) {
                        console.log(`Pre-insert merged into existing activity ${existingMatch.id}`)
                        mergedCount++
                        // Reflect the merge in the in-memory window so this row is no
                        // longer an available merge target for later activities.
                        existingMatch.strava_id = activity.id?.toString()
                        existingMatch.source = 'merged'
                    } else {
                        console.error('Pre-insert merge failed:', updateError)
                    }
                    continue
                }

                // Insert new activity
                const activityData: any = {
                    athlete_id: athleteId,
                    strava_id: activity.id?.toString(),
                    source: 'strava',
                    activity_name: activity.name,
                    activity_type: activity.type,
                    start_time: activity.start_date,
                    distance_meters: activity.distance,
                    duration_seconds: activity.elapsed_time,
                    moving_duration_seconds: activity.moving_time,
                    avg_hr: activity.average_heartrate ?? null,
                    max_hr: activity.max_heartrate ?? null,
                    elevation_gain_meters: activity.total_elevation_gain ?? null,
                    strava_data: {
                        workout_type: activity.workout_type,
                        sport_type: activity.sport_type,
                        trainer: activity.trainer,
                        commute: activity.commute
                    },
                    synced_from_strava: new Date().toISOString()
                }

                console.log('Inserting Strava activity:', activityData)

                const { data: inserted, error } = await supabase
                    .from('activities')
                    .insert(activityData)
                    .select()
                    .single()

                if (error) {
                    console.error('Failed to upsert Strava activity:', {
                        error,
                        activityData,
                        errorDetails: error.message,
                        errorCode: error.code
                    })
                    continue
                }

                console.log('Successfully synced activity:', inserted?.id)
                syncedCount++

                // Check for merge candidates (fallback). Filter the in-memory
                // window instead of re-querying.
                const searchMs = new Date(activity.start_date).getTime()
                const lo = subHours(new Date(searchMs), 12).getTime()
                const hi = addHours(new Date(searchMs), 12).getTime()
                const potentialMatches = windowActivities.filter(a => {
                    if (a.source === 'strava' || a.strava_id != null) return false
                    const t = new Date(a.start_time).getTime()
                    return t >= lo && t <= hi
                })

                if (potentialMatches && potentialMatches.length > 0) {
                    console.log(`Found ${potentialMatches.length} potential matches for activity ${inserted.id}`)
                    const newActivityObj = {
                        ...inserted,
                        start_time: activity.start_date,
                        duration_seconds: activity.elapsed_time,
                        distance_meters: activity.distance,
                        source: 'strava'
                    }

                    const mergeCandidate = findMergeCandidates(newActivityObj, potentialMatches)

                    if (mergeCandidate) {
                        console.log(`Merge candidate found: ${mergeCandidate.activity2.id} with confidence ${mergeCandidate.confidence} (score: ${mergeCandidate.confidenceScore})`)
                        if (shouldAutoMerge(mergeCandidate)) {
                            console.log(`Checking tie-breaker: Existing ID ${mergeCandidate.activity2.id} < Inserted ID ${inserted.id}? ${mergeCandidate.activity2.id! < inserted.id}`)

                            if (mergeCandidate.activity2.id! < inserted.id) {
                                console.log(`Merging newly inserted activity ${inserted.id} into existing ${mergeCandidate.activity2.id}`)

                                // Delete the newly inserted activity FIRST
                                const { error: deleteError } = await supabase
                                    .from('activities')
                                    .delete()
                                    .eq('id', inserted.id)

                                if (deleteError) {
                                    console.error('Failed to delete duplicate activity before merge:', deleteError)
                                    continue
                                }

                                // Update the existing activity
                                const preference = athlete?.preferred_activity_data_source || 'most_recent'
                                const shouldUpdateDetails = preference === 'strava' || preference === 'most_recent'

                                const updateData: any = {
                                    strava_id: activity.id?.toString(),
                                    synced_from_strava: new Date().toISOString(),
                                    source: 'merged',
                                    strava_data: {
                                        workout_type: activity.workout_type,
                                        sport_type: activity.sport_type,
                                        trainer: activity.trainer,
                                        commute: activity.commute
                                    }
                                }

                                if (shouldUpdateDetails) {
                                    updateData.activity_name = activity.name
                                    updateData.activity_type = activity.type
                                }

                                const { error: updateError } = await supabase
                                    .from('activities')
                                    .update(updateData)
                                    .eq('id', mergeCandidate.activity2.id)

                                if (!updateError) {
                                    console.log(`Successfully merged ${inserted.id} into ${mergeCandidate.activity2.id}`)
                                    mergedCount++
                                    // Reflect the merge in the in-memory window.
                                    const merged = windowActivities.find(a => a.id === mergeCandidate.activity2.id)
                                    if (merged) {
                                        merged.strava_id = activity.id?.toString()
                                        merged.source = 'merged'
                                    }
                                } else {
                                    console.error('Failed to merge update:', updateError)
                                }
                            } else {
                                console.log(`Match found (${mergeCandidate.activity2.id}) but has larger ID than inserted (${inserted.id}). Skipping merge to avoid race condition.`)
                            }
                        } else {
                            console.log(`Merge candidate found but confidence too low: ${mergeCandidate.confidence}`)
                            // Medium/low confidence - flag for review
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

                            // Also update the activity status
                            await supabase
                                .from('activities')
                                .update({
                                    merge_status: 'pending_review',
                                    confidence_score: mergeCandidate.confidenceScore
                                })
                                .eq('id', inserted.id)

                            pendingReviewCount++
                        }
                    } else {
                        console.log(`No valid merge candidate found among ${potentialMatches.length} potential matches`)
                    }
                } else {
                    console.log(`No potential matches found in DB for activity ${inserted.id}`)
                }
            }

            // Update last synced timestamp (previously never written for Strava)
            await supabase
                .from('athlete_integrations')
                .update({ last_synced_at: new Date().toISOString() })
                .eq('athlete_id', athleteId)
                .eq('platform', 'strava')

            return NextResponse.json({
                success: true,
                message: 'Strava sync completed',
                synced: syncedCount,
                merged: mergedCount,
                pendingReview: pendingReviewCount
            })
        } finally {
            // Always release sync lock
            await releaseSyncLock(supabase, athleteId)
        }
    } catch (error) {
        console.error('Strava sync error:', error)
        return NextResponse.json(
            { error: 'Failed to sync with Strava', details: String(error) },
            { status: 500 }
        )
    }
}
