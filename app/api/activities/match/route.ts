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
import { computeComplianceScore, buildScoringResult } from '@/lib/activities/scoring'
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
            .select('id, completed_activity_id, workout_type, distance_target_meters, duration_target_seconds, structured_workout')
            .eq('athlete_id', user.id)
            .not('completed_activity_id', 'is', null)

        if (!linkedWorkouts || linkedWorkouts.length === 0) {
            return NextResponse.json({ success: true, rescored: 0 })
        }

        // Batch-load the activities and laps once, instead of ~3 queries per
        // workout over the athlete's full linked history (the old N+1).
        const activityIds = [...new Set(
            linkedWorkouts.map(w => w.completed_activity_id).filter((id): id is number => id != null)
        )]

        const activitiesById = new Map<number, { id: number; distance_meters: number | null; duration_seconds: number | null }>()
        const lapsByActivity = new Map<number, { intensity_type: string | null; compliance_score: number | null }[]>()

        for (let i = 0; i < activityIds.length; i += 200) {
            const chunk = activityIds.slice(i, i + 200)
            const [{ data: activityRows }, { data: lapRows }] = await Promise.all([
                supabase
                    .from('activities')
                    .select('id, distance_meters, duration_seconds')
                    .in('id', chunk),
                supabase
                    .from('laps')
                    .select('activity_id, intensity_type, compliance_score')
                    .in('activity_id', chunk)
                    .not('compliance_score', 'is', null),
            ])
            for (const a of activityRows ?? []) activitiesById.set(a.id, a)
            for (const lap of lapRows ?? []) {
                const list = lapsByActivity.get(lap.activity_id) ?? []
                list.push({ intensity_type: lap.intensity_type, compliance_score: lap.compliance_score })
                lapsByActivity.set(lap.activity_id, list)
            }
        }

        let rescored = 0
        const errors: string[] = []

        // Score in memory; run the per-row updates in parallel.
        await Promise.all(linkedWorkouts.map(async workout => {
            const activity = activitiesById.get(workout.completed_activity_id!)
            if (!activity) return

            const compliance = computeComplianceScore(lapsByActivity.get(activity.id) ?? [])
            const result = buildScoringResult(activity, workout, compliance)

            const { error } = await supabase
                .from('planned_workouts')
                .update({
                    completion_status: result.completionStatus,
                    completion_metadata: result.completionMetadata,
                })
                .eq('id', workout.id)

            if (error) {
                errors.push(`Workout ${workout.id}: ${error.message}`)
            } else {
                rescored++
            }
        }))

        return NextResponse.json({ success: true, rescored, total: linkedWorkouts.length, errors })
    } catch (error) {
        console.error('Bulk re-score error:', error)
        return NextResponse.json(
            { error: 'Re-score failed', message: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 }
        )
    }
}
