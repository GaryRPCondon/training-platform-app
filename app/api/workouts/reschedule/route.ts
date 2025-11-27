import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { workoutId, newDate } = await request.json()

        if (!workoutId || !newDate) {
            return NextResponse.json({ error: 'Workout ID and new date required' }, { status: 400 })
        }

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
