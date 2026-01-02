/**
 * Phase 6: Activity Matching API
 *
 * POST /api/activities/match
 * Triggers auto-matching of activities to workouts for a date range
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { matchActivitiesToWorkouts } from '@/lib/activities/workout-matcher'

export async function POST(request: Request) {
    try {
        const { startDate, endDate } = await request.json()

        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const matches = await matchActivitiesToWorkouts(supabase, user.id, startDate, endDate)

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
