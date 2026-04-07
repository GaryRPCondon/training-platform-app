/**
 * Phase 6: Activity Matching API
 *
 * POST /api/activities/match
 * Triggers auto-matching of activities to workouts for a date range
 */

import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createClient } from '@/lib/supabase/server'
import { matchActivitiesToWorkouts } from '@/lib/activities/workout-matcher'
import { rescoreCompletion } from '@/lib/activities/rescore-completion'
import { captureDescriptionsForMatches } from '@/lib/activities/capture-descriptions'
import { triggerSummaryGeneration } from '@/lib/activities/trigger-summary'
import { z } from 'zod'

const matchSchema = z.object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

export async function POST(request: Request) {
    try {
        const body = await request.json()
        const parsed = matchSchema.safeParse(body)
        if (!parsed.success) {
            return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
        }
        const { startDate, endDate } = parsed.data

        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const resolvedStart = startDate ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
        const resolvedEnd = endDate ?? new Date().toISOString().slice(0, 10)
        const matches = await matchActivitiesToWorkouts(supabase, user.id, resolvedStart, resolvedEnd)

        // For newly matched activities: capture platform descriptions and generate AI summaries
        if (matches.length > 0) {
            const matchedIds = matches.map(m => m.activityId)
            await captureDescriptionsForMatches(supabase, user.id, matchedIds)
            // Keep Lambda alive after response is sent so the LLM calls complete
            waitUntil(
                triggerSummaryGeneration(supabase, user.id, matchedIds).catch(err => {
                    console.error('[Match] Summary generation error:', err)
                })
            )
        }

        return NextResponse.json({
            success: true,
            matchCount: matches.length,
            matches,
        })
    } catch (error) {
        console.error('Matching error:', error)
        return NextResponse.json(
            {
                error: 'Matching failed',
                message: error instanceof Error ? error.message : 'Unknown error'
            },
            { status: 500 }
        )
    }
}

/**
 * PATCH /api/activities/match
 * Bulk re-score all linked workouts for the authenticated athlete.
 * Backfills accuracy_score from Garmin compliance data.
 */
export async function PATCH() {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { data: linkedWorkouts } = await supabase
            .from('planned_workouts')
            .select('id, completed_activity_id')
            .eq('athlete_id', user.id)
            .not('completed_activity_id', 'is', null)

        if (!linkedWorkouts || linkedWorkouts.length === 0) {
            return NextResponse.json({ success: true, rescored: 0 })
        }

        let rescored = 0
        const errors: string[] = []

        for (const workout of linkedWorkouts) {
            try {
                await rescoreCompletion(supabase, workout.completed_activity_id!, workout.id)
                rescored++
            } catch (e) {
                errors.push(`Workout ${workout.id}: ${e instanceof Error ? e.message : 'Unknown error'}`)
            }
        }

        return NextResponse.json({ success: true, rescored, total: linkedWorkouts.length, errors })
    } catch (error) {
        console.error('Bulk re-score error:', error)
        return NextResponse.json(
            { error: 'Re-score failed', message: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 }
        )
    }
}
