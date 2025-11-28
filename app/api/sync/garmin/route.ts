import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { findMergeCandidates, shouldAutoMerge } from '@/lib/activities/merge-detector'
import { format } from 'date-fns'

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

        // Use the athlete ID for all subsequent operations
        const athleteId = athlete.id

        // Fetch activities from Garmin MCP server
        const garminResponse = await fetch(
            `http://localhost:3001/activities?startDate=${startDate}&endDate=${endDate}`
        )

        if (!garminResponse.ok) {
            throw new Error('Failed to fetch from Garmin bridge')
        }

        const garminActivities = await garminResponse.json()

        console.log('Garmin sync - Date range:', startDate, 'to', endDate)
        console.log('Garmin sync - Fetched activities:', garminActivities?.length || 0)
        console.log('Garmin sync - Sample activity:', garminActivities?.[0])

        // Fetch existing activities for matching
        const { data: existingActivities } = await supabase
            .from('activities')
            .select('*')
            .eq('athlete_id', athleteId)
            .gte('start_time', startDate)
            .lte('start_time', endDate)

        let syncedCount = 0
        let mergedCount = 0
        let pendingReviewCount = 0

        if (!garminActivities || !Array.isArray(garminActivities)) {
            console.error('Invalid response from Garmin bridge:', garminActivities)
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

            const durationSeconds = typeof activity.duration === 'object'
                ? activity.duration?.seconds
                : activity.duration

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

            // Check for merge candidates
            const mergeCandidate = findMergeCandidates(newActivity, existingActivities || [])

            if (mergeCandidate && shouldAutoMerge(mergeCandidate)) {
                // Auto-merge: update existing activity with Garmin ID
                const { error } = await supabase
                    .from('activities')
                    .update({
                        garmin_id: activity.activityId?.toString(),
                        synced_from_garmin: new Date().toISOString(),
                        source: 'merged'
                    })
                    .eq('id', mergeCandidate.activity2.id)

                if (!error) {
                    syncedCount++
                    mergedCount++
                }
                continue
            }

            // Insert new activity
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

            if (mergeCandidate) {
                // Medium/low confidence - flag for review
                activityData.merge_status = 'pending_review'
                activityData.confidence_score = mergeCandidate.confidenceScore
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
            } else {
                console.log('Successfully synced activity:', inserted?.id)
                syncedCount++

                if (mergeCandidate && inserted) {
                    // Create merge flag
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
