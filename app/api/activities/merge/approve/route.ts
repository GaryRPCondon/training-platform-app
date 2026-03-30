import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const mergeApproveSchema = z.object({
    activity1Id: z.number(),
    activity2Id: z.number(),
})

export async function POST(request: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const parsed = mergeApproveSchema.safeParse(body)
        if (!parsed.success) {
            return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
        }
        const { activity1Id, activity2Id } = parsed.data

        // Fetch both activities
        const { data: activities } = await supabase
            .from('activities')
            .select('*')
            .in('id', [activity1Id, activity2Id])
            .eq('athlete_id', user.id)

        if (!activities || activities.length !== 2) {
            return NextResponse.json({ error: 'Activities not found' }, { status: 404 })
        }

        const [act1, act2] = activities

        // Merge: keep the first activity, add IDs from second
        const mergedData: any = {}

        if (act2.garmin_id) mergedData.garmin_id = act2.garmin_id
        if (act2.strava_id) mergedData.strava_id = act2.strava_id
        if (act2.synced_from_garmin) mergedData.synced_from_garmin = act2.synced_from_garmin
        if (act2.synced_from_strava) mergedData.synced_from_strava = act2.synced_from_strava

        mergedData.source = 'merged'
        mergedData.merge_status = 'merged'

        // Update first activity
        const { error: updateError } = await supabase
            .from('activities')
            .update(mergedData)
            .eq('id', activity1Id)

        if (updateError) throw updateError

        // Delete second activity
        const { error: deleteError } = await supabase
            .from('activities')
            .delete()
            .eq('id', activity2Id)

        if (deleteError) throw deleteError

        // Remove merge flags
        await supabase
            .from('workout_flags')
            .delete()
            .eq('activity_id', activity1Id)
            .eq('flag_type', 'merge_candidate')

        await supabase
            .from('workout_flags')
            .delete()
            .eq('activity_id', activity2Id)
            .eq('flag_type', 'merge_candidate')

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Merge approval error:', error)
        return NextResponse.json({ error: 'Failed to merge activities' }, { status: 500 })
    }
}
