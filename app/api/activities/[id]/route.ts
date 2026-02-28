import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const activityId = parseInt(id, 10)
        if (isNaN(activityId)) {
            return NextResponse.json({ error: 'Invalid activity ID' }, { status: 400 })
        }

        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { data: activity, error } = await supabase
            .from('activities')
            .select('id, activity_name, activity_type, start_time, distance_meters, duration_seconds, avg_hr, max_hr, source')
            .eq('id', activityId)
            .eq('athlete_id', user.id)
            .single()

        if (error || !activity) {
            return NextResponse.json({ error: 'Activity not found' }, { status: 404 })
        }

        return NextResponse.json({ activity })
    } catch (error) {
        console.error('Failed to fetch activity:', error)
        return NextResponse.json({ error: 'Failed to fetch activity' }, { status: 500 })
    }
}
