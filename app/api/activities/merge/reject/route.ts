import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const rejectSchema = z.object({ activityId: z.number() })

export async function POST(request: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const parsed = rejectSchema.safeParse(body)
        if (!parsed.success) {
            return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
        }
        const { activityId } = parsed.data

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
