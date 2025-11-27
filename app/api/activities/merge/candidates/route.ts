import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Get activities with pending merge status
        const { data: pendingActivities } = await supabase
            .from('activities')
            .select('*')
            .eq('athlete_id', user.id)
            .eq('merge_status', 'pending_review')
            .order('start_time', { ascending: false })

        if (!pendingActivities || pendingActivities.length === 0) {
            return NextResponse.json({ pairs: [] })
        }

        // Get flags to find match IDs
        const activityIds = pendingActivities.map(a => a.id)
        const { data: flags } = await supabase
            .from('workout_flags')
            .select('*')
            .in('activity_id', activityIds)
            .eq('flag_type', 'merge_candidate')

        const pairs = []

        for (const activity of pendingActivities) {
            const flag = flags?.find(f => f.activity_id === activity.id)
            if (!flag || !flag.flag_data?.potential_match_id) continue

            const { data: matchActivity } = await supabase
                .from('activities')
                .select('*')
                .eq('id', flag.flag_data.potential_match_id)
                .single()

            if (matchActivity) {
                pairs.push({
                    activity,
                    matchActivity,
                    confidence: flag.flag_data.confidence || 'medium',
                    confidenceScore: Math.round(flag.flag_data.confidence_score || 70)
                })
            }
        }

        return NextResponse.json({ pairs })
    } catch (error) {
        console.error('Failed to fetch merge candidates:', error)
        return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 })
    }
}
