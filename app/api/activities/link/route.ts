/**
 * Phase 6: Activity Linking API
 *
 * POST /api/activities/link - Manually link activity to workout
 * DELETE /api/activities/link - Unlink activity from workout
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { manuallyLinkWorkout, unlinkWorkout } from '@/lib/activities/workout-matcher'

export async function POST(request: Request) {
    try {
        const { activityId, workoutId, reason } = await request.json()

        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        await manuallyLinkWorkout(supabase, activityId, workoutId, user.id, reason)

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Link error:', error)
        return NextResponse.json({ error: 'Link failed' }, { status: 500 })
    }
}

export async function DELETE(request: Request) {
    try {
        const { activityId } = await request.json()

        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        await unlinkWorkout(supabase, activityId, user.id)

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Unlink error:', error)
        return NextResponse.json({ error: 'Unlink failed' }, { status: 500 })
    }
}
