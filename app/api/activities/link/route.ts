/**
 * Phase 6: Activity Linking API
 *
 * POST /api/activities/link - Manually link activity to workout
 * DELETE /api/activities/link - Unlink activity from workout
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { manuallyLinkWorkout, unlinkWorkout } from '@/lib/activities/workout-matcher'
import { captureDescriptionsForMatches } from '@/lib/activities/capture-descriptions'
import { triggerSummaryGeneration } from '@/lib/activities/trigger-summary'
import { z } from 'zod'

const linkSchema = z.object({
    activityId: z.number(),
    workoutId: z.number(),
    reason: z.string().max(200).optional(),
})

const unlinkSchema = z.object({ activityId: z.number() })

export async function POST(request: Request) {
    try {
        const body = await request.json()
        const parsed = linkSchema.safeParse(body)
        if (!parsed.success) {
            return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
        }
        const { activityId, workoutId, reason } = parsed.data

        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        await manuallyLinkWorkout(supabase, activityId, workoutId, user.id, reason)

        // Capture platform descriptions and generate AI summary
        await captureDescriptionsForMatches(supabase, user.id, [activityId])
        triggerSummaryGeneration(supabase, user.id, [activityId]).catch(err => {
            console.error('[Link] Summary generation error:', err)
        })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Link error:', error)
        return NextResponse.json({ error: 'Link failed' }, { status: 500 })
    }
}

export async function DELETE(request: Request) {
    try {
        const body = await request.json()
        const parsed = unlinkSchema.safeParse(body)
        if (!parsed.success) {
            return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
        }
        const { activityId } = parsed.data

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
