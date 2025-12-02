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

        const athleteId = athlete.id

        // Fetch activities from Strava MCP server
        const stravaResponse = await fetch(
            `http://localhost:3002/activities?startDate=${startDate}&endDate=${endDate}`
        )

        if (!stravaResponse.ok) {
            throw new Error('Failed to fetch from Strava bridge')
        }

        const stravaActivities = await stravaResponse.json()

        console.log('Strava sync - Date range:', startDate, 'to', endDate)
        console.log('Strava sync - Fetched activities:', stravaActivities?.length || 0)
        console.log('Strava sync - Sample activity:', stravaActivities?.[0])

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

        // Apply limit if specified
        const activitiesToProcess = limit ? stravaActivities.slice(0, limit) : stravaActivities
        console.log(`Processing ${activitiesToProcess.length} activities (limit: ${limit || 'none'})...`)

        for (const activity of activitiesToProcess) {
            const newActivity = {
                start_time: activity.start_date,
                duration_seconds: activity.moving_time,
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

            // Check for merge candidates
            const mergeCandidate = findMergeCandidates(newActivity, existingActivities || [])

            if (mergeCandidate && shouldAutoMerge(mergeCandidate)) {
                // Auto-merge: update existing activity with Strava ID
                const { error } = await supabase
                    .from('activities')
                    .update({
                        strava_id: activity.id?.toString(),
                        synced_from_strava: new Date().toISOString(),
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
                strava_id: activity.id?.toString(),
                source: 'strava',
                activity_name: activity.name,
                activity_type: activity.type,
                start_time: activity.start_date,
                distance_meters: activity.distance,
                duration_seconds: activity.moving_time,
                synced_from_strava: new Date().toISOString()
            }

            if (mergeCandidate) {
                // Medium/low confidence - flag for review
                activityData.merge_status = 'pending_review'
                activityData.confidence_score = mergeCandidate.confidenceScore
            }

            console.log('Upserting Strava activity:', activityData)

            const { data: inserted, error } = await supabase
                .from('activities')
                .upsert(activityData, {
                    onConflict: 'athlete_id,strava_id',
                    ignoreDuplicates: false
                })
                .select()
                .single()

            if (error) {
                console.error('Failed to upsert Strava activity:', {
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
