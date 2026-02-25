import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const workoutId = parseInt(id, 10)
        if (isNaN(workoutId)) {
            return NextResponse.json({ error: 'Invalid workout ID' }, { status: 400 })
        }

        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { data: workout, error } = await supabase
            .from('planned_workouts')
            .select('id, scheduled_date, workout_type, description, distance_target_meters, duration_target_seconds, intensity_target, structured_workout, completion_status')
            .eq('id', workoutId)
            .eq('athlete_id', user.id)
            .single()

        if (error || !workout) {
            return NextResponse.json({ error: 'Workout not found' }, { status: 404 })
        }

        return NextResponse.json({ workout })
    } catch (error) {
        console.error('Failed to fetch workout:', error)
        return NextResponse.json({ error: 'Failed to fetch workout' }, { status: 500 })
    }
}
