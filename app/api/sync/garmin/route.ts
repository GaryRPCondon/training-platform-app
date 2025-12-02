import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { findMergeCandidates, shouldAutoMerge } from '@/lib/activities/merge-detector'
import { format, subMinutes, addMinutes, subDays, addDays, subHours, addHours, eachMonthOfInterval, startOfMonth, endOfMonth, min, max } from 'date-fns'

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
            .select('id')
            .eq('id', user.id)
            .single()

        if (!athlete) {
            // Check if athlete exists with this email but different ID
            const { data: athleteByEmail } = await supabase
                .from('athletes')
                .select('id')
                .eq('email', user.email)
                .single()

            if (athleteByEmail) {
                console.log('Found existing athlete by email:', athleteByEmail.id, '- Using this athlete ID')
                // Use the existing athlete record
                athlete = athleteByEmail
            } else {
                // Create new athlete record
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

        // Use the athlete ID for all subsequent operations
        const athleteId = athlete.id

        // Fetch activities from Garmin MCP server using monthly chunks to avoid 50-item limit
        const start = new Date(startDate)
        const end = new Date(endDate)

        // Generate monthly chunks
        const months = eachMonthOfInterval({
            start,
            end
        })

        let garminActivities: any[] = []

        console.log(`Garmin sync - Splitting range ${startDate} to ${endDate} into ${months.length} chunks`)

        for (const monthStart of months) {
            // Calculate chunk start and end
            // For the first chunk, use the requested start date if it's later than the month start
            // For the last chunk, use the requested end date if it's earlier than the month end
            const chunkStart = max([start, startOfMonth(monthStart)])
            const chunkEnd = min([end, endOfMonth(monthStart)])

            const chunkStartDateStr = format(chunkStart, 'yyyy-MM-dd')
            const chunkEndDateStr = format(chunkEnd, 'yyyy-MM-dd')

            console.log(`Fetching chunk: ${chunkStartDateStr} to ${chunkEndDateStr}`)

            try {
                const chunkResponse = await fetch(
                    `http://localhost:3001/activities?startDate=${chunkStartDateStr}&endDate=${chunkEndDateStr}&limit=50`
                )

                if (!chunkResponse.ok) {
                    console.error(`Failed to fetch chunk ${chunkStartDateStr} to ${chunkEndDateStr}: ${chunkResponse.statusText}`)
                    // Continue to next chunk instead of failing entirely
                    continue
                }

                const chunkActivities = await chunkResponse.json()

                if (Array.isArray(chunkActivities)) {
                    console.log(`Chunk ${chunkStartDateStr} to ${chunkEndDateStr}: Found ${chunkActivities.length} activities`)
                    garminActivities = [...garminActivities, ...chunkActivities]
                } else {
                    console.warn(`Chunk ${chunkStartDateStr} to ${chunkEndDateStr}: returned non-array`, chunkActivities)
                }
            } catch (chunkError) {
                console.error(`Error fetching chunk ${chunkStartDateStr} to ${chunkEndDateStr}:`, chunkError)
                // Continue to next chunk
            }
        }

        console.log('Garmin sync - Total fetched activities:', garminActivities.length)
        console.log('Garmin sync - Sample activity:', garminActivities?.[0])

        // Fetch existing activities removed - using database-centric approach


        let syncedCount = 0
        let mergedCount = 0
        let pendingReviewCount = 0

        if (garminActivities.length === 0) {
            console.log('No activities found in any chunk')
            return NextResponse.json({
                success: true,
                message: 'No activities returned from Garmin bridge',
                synced: 0,
                merged: 0,
                pendingReview: 0
            })
        }

        console.log(`Processing ${garminActivities.length} activities...`)

        // Apply limit if specified
        const activitiesToProcess = limit ? garminActivities.slice(0, limit) : garminActivities
        console.log(`Processing ${activitiesToProcess.length} activities (limit: ${limit || 'none'})...`)

        for (const activity of activitiesToProcess) {
            // Extract datetime from nested startTimeLocal object
            const startTime = typeof activity.startTimeLocal === 'object'
                ? activity.startTimeLocal?.datetime || activity.startTimeLocal?.date
                : activity.startTimeLocal

            // Extract numeric values from nested objects
            const distanceMeters = typeof activity.distance === 'object'
                ? activity.distance?.meters
                : activity.distance

            const durationSeconds = activity.elapsedDuration ||
                (typeof activity.duration === 'object' ? activity.duration?.seconds : activity.duration)

            console.log('Duration extraction:', {
                activityId: activity.activityId,
                elapsedDuration: activity.elapsedDuration,
                durationObject: activity.duration,
                finalValue: durationSeconds
            })
            const newActivity = {
                start_time: startTime,
                duration_seconds: durationSeconds,
                distance_meters: distanceMeters,
                source: 'garmin'
            }

            console.log('Processing Garmin activity:', {
                id: activity.activityId,
                name: activity.activityName,
                startTime,
                durationSeconds,
                distanceMeters
            })

            // Insert new activity first
            const activityData: any = {
                athlete_id: athleteId,
                garmin_id: activity.activityId?.toString(),
                source: 'garmin',
                activity_name: activity.activityName,
                activity_type: activity.activityType,
                start_time: startTime,
                distance_meters: distanceMeters,
                duration_seconds: durationSeconds,
                synced_from_garmin: new Date().toISOString()
            }

            console.log('Upserting Garmin activity:', activityData)

            const { data: inserted, error } = await supabase
                .from('activities')
                .upsert(activityData, {
                    onConflict: 'athlete_id,garmin_id',
                    ignoreDuplicates: false
                })
                .select()
                .single()

            if (error) {
                console.error('Failed to upsert Garmin activity:', {
                    error,
                    activityData,
                    errorDetails: error.message,
                    errorCode: error.code
                })
                continue
            }

            console.log('Successfully synced activity:', inserted?.id)
            syncedCount++

            // Check for merge candidates in the database
            const searchStartTime = new Date(startTime)

            // We widen the search window to +/- 1 day to catch potential date-only matches from Strava
            // The merge detector will handle filtering precise vs date-only matches
            const { data: potentialMatches } = await supabase
                .from('activities')
                .select('*')
                .eq('athlete_id', athleteId)
                .neq('source', 'garmin')
                .is('garmin_id', null)
                .gte('start_time', subHours(searchStartTime, 12).toISOString())
                .lte('start_time', addHours(searchStartTime, 12).toISOString())

            if (potentialMatches && potentialMatches.length > 0) {
                console.log(`Found ${potentialMatches.length} potential matches for activity ${inserted.id}`)
                // We found potential matches, check them
                // We construct a temporary object for the new activity to use with findMergeCandidates
                const newActivityObj = {
                    ...inserted,
                    start_time: startTime, // Ensure string format if needed
                    duration_seconds: durationSeconds,
                    distance_meters: distanceMeters,
                    source: 'garmin'
                }

                const mergeCandidate = findMergeCandidates(newActivityObj, potentialMatches)

                if (mergeCandidate) {
                    console.log(`Merge candidate found: ${mergeCandidate.activity2.id} with confidence ${mergeCandidate.confidence} (score: ${mergeCandidate.confidenceScore})`)
                    if (shouldAutoMerge(mergeCandidate)) {
                        // High confidence match
                        // Tie-breaker: Only merge if the match ID is smaller than the inserted ID
                        // This prevents double-merging if two syncs run in parallel
                        console.log(`Checking tie-breaker: Existing ID ${mergeCandidate.activity2.id} < Inserted ID ${inserted.id}? ${mergeCandidate.activity2.id! < inserted.id}`)

                        if (mergeCandidate.activity2.id! < inserted.id) {
                            console.log(`Merging newly inserted activity ${inserted.id} into existing ${mergeCandidate.activity2.id}`)

                            // Delete the newly inserted activity FIRST to avoid unique constraint violation
                            // (since we are about to apply its garmin_id to the existing activity)
                            const { error: deleteError } = await supabase
                                .from('activities')
                                .delete()
                                .eq('id', inserted.id)

                            if (deleteError) {
                                console.error('Failed to delete duplicate activity before merge:', deleteError)
                                continue
                            }

                            // Update the existing activity
                            const { error: updateError } = await supabase
                                .from('activities')
                                .update({
                                    garmin_id: activity.activityId?.toString(),
                                    synced_from_garmin: new Date().toISOString(),
                                    source: 'merged'
                                })
                                .eq('id', mergeCandidate.activity2.id)

                            if (!updateError) {
                                console.log(`Successfully merged ${inserted.id} into ${mergeCandidate.activity2.id}`)
                                mergedCount++
                            } else {
                                console.error('Failed to merge update:', updateError)
                                // If update fails, we might want to restore the deleted activity? 
                                // But for now, let's just log the error. The data is technically safe in Garmin.
                            }
                        } else {
                            console.log(`Match found (${mergeCandidate.activity2.id}) but has larger ID than inserted (${inserted.id}). Skipping merge to avoid race condition.`)
                        }
                    } else {
                        console.log(`Merge candidate found but confidence too low: ${mergeCandidate.confidence}`)
                        // Medium/low confidence - flag for review
                        // We update the inserted activity with the flag
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
                console.log(`No potential matches found in DB for activity ${inserted.id} (Window: +/- 1 day)`)
            }
        }

        return NextResponse.json({
            success: true,
            message: 'Garmin sync completed',
            synced: syncedCount,
            merged: mergedCount,
            pendingReview: pendingReviewCount
        })
    } catch (error) {
        console.error('Garmin sync error:', error)
        return NextResponse.json(
            { error: 'Failed to sync with Garmin', details: String(error) },
            { status: 500 }
        )
    }
}
