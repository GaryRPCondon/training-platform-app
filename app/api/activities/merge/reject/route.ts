import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { activityId } = await request.json()

        if (!activityId) {
            return NextResponse.json({ error: 'Activity ID required' }, { status: 400 })
        }

        // Update activity to mark as kept separate
        const { error } = await supabase
            .from('activities')
            .update({ merge_status: 'kept_separate' })
            .eq('id', activityId)
            .eq('athlete_id', user.id)

        if (error) throw error

        // Remove merge flag
        await supabase
            .from('workout_flags')
            .delete()
            .eq('activity_id', activityId)
            .eq('flag_type', 'merge_candidate')

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Keep separate error:', error)
        return NextResponse.json({ error: 'Failed to update activity' }, { status: 500 })
    }
}
