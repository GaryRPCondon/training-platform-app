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
            .select('id')
            .eq('id', workoutId)
            .eq('athlete_id', user.id)
            .single()

        if (fetchError || !workout) {
            return NextResponse.json({ error: 'Workout not found' }, { status: 404 })
        }

        // Update workout date
        const { error: updateError } = await supabase
            .from('planned_workouts')
            .update({ scheduled_date: newDate })
            .eq('id', workoutId)

        if (updateError) throw updateError

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Failed to reschedule workout:', error)
        return NextResponse.json({ error: 'Failed to reschedule workout' }, { status: 500 })
    }
}
