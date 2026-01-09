import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { findMergeCandidates, shouldAutoMerge } from '@/lib/activities/merge-detector'
import { format, subMinutes, addMinutes, subDays, addDays, subHours, addHours } from 'date-fns'

export async function POST(request: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const startDate = body.startDate || format(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd')
        const endDate = body.endDate || format(new Date(), 'yyyy-MM-dd')
        const limit = body.limit // Optional limit for number of activities

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

        // Fetch existing activities removed - using database-centric approach

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

        // Limit is handled by API per_page parameter
        const activitiesToProcess = stravaActivities
        console.log(`Processing ${activitiesToProcess.length} activities...`)

        for (const activity of activitiesToProcess) {
            const newActivity = {
                start_time: activity.start_date,
                duration_seconds: activity.elapsed_time,
                distance_meters: activity.distance,
                source: 'strava'
            }

            console.log('Processing Strava activity:', {
                id: activity.id,
                name: activity.name,
                start_date: activity.start_date,
                moving_time: activity.moving_time,
                distance: activity.distance
            })

            // Check for merge candidates in the database
            const searchStartTime = new Date(activity.start_date)

            // We widen the search window to +/- 12 hours to catch potential timezone differences
            // The merge detector will handle filtering precise vs date-only matches
            const query = supabase
                .from('activities')
                .select('*')
                .eq('athlete_id', athleteId)
                .neq('source', 'strava')
                .is('strava_id', null)
                .gte('start_time', subHours(searchStartTime, 12).toISOString())
                .lte('start_time', addHours(searchStartTime, 12).toISOString())

            const { data: potentialMatches } = await query

            // Check if this Strava activity already exists
            const { data: existingStrava } = await supabase
                .from('activities')
                .select('id, source')
                .eq('athlete_id', athleteId)
                .eq('strava_id', activity.id?.toString())
                .single()

            if (existingStrava) {
                console.log(`Strava activity ${activity.id} already exists (ID: ${existingStrava.id}, source: ${existingStrava.source}), skipping`)
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
                .insert(activityData)  // Changed from upsert to insert
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
                        // High confidence match
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
                            // Respect user's data priority preference
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

                            // Only update activity name/type if preference allows
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

        return NextResponse.json({
            success: true,
            message: 'Strava sync completed',
            synced: syncedCount,
            merged: mergedCount,
            pendingReview: pendingReviewCount
        })
    } catch (error) {
        console.error('Strava sync error:', error)
        return NextResponse.json(
            { error: 'Failed to sync with Strava', details: String(error) },
            { status: 500 }
        )
    }
}
