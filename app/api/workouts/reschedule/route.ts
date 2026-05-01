import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const rescheduleSchema = z.object({
    workoutId: z.number(),
    newDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format'),
})

export async function POST(request: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const parsed = rescheduleSchema.safeParse(body)
        if (!parsed.success) {
            return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
        }
        const { workoutId, newDate } = parsed.data

        // Verify workout belongs to user
        const { data: workout, error: fetchError } = await supabase
            .from('planned_workouts')
            .select('id, scheduled_date')
            .eq('id', workoutId)
            .eq('athlete_id', user.id)
            .single()

        if (fetchError || !workout) {
            return NextResponse.json({ error: 'Workout not found' }, { status: 404 })
        }

        const oldDate = workout.scheduled_date

        // Update workout date
        const { error: updateError } = await supabase
            .from('planned_workouts')
            .update({ scheduled_date: newDate, session_order: 1 })
            .eq('id', workoutId)

        if (updateError) throw updateError

        // Orphan normalisation: if the moved workout was part of a split-run pair,
        // the leftover sibling should reset to session_order=1 so badges read coherently.
        if (oldDate !== newDate) {
            const { data: leftover } = await supabase
                .from('planned_workouts')
                .select('id')
                .eq('athlete_id', user.id)
                .eq('scheduled_date', oldDate)
            if (leftover && leftover.length === 1) {
                await supabase
                    .from('planned_workouts')
                    .update({ session_order: 1 })
                    .eq('id', leftover[0].id)
            }
        }

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Failed to reschedule workout:', error)
        return NextResponse.json({ error: 'Failed to reschedule workout' }, { status: 500 })
    }
}
