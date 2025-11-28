import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function DELETE() {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Get athlete ID
        let { data: athlete } = await supabase
            .from('athletes')
            .select('id')
            .eq('id', user.id)
            .single()

        if (!athlete) {
            // Try looking up by email
            const { data: athleteByEmail } = await supabase
                .from('athletes')
                .select('id')
                .eq('email', user.email)
                .single()

            if (athleteByEmail) {
                athlete = athleteByEmail
            } else {
                return NextResponse.json({ error: 'Athlete not found' }, { status: 404 })
            }
        }

        // Delete all activities for this athlete
        const { error, count } = await supabase
            .from('activities')
            .delete({ count: 'exact' })
            .eq('athlete_id', athlete.id)

        if (error) {
            console.error('Failed to delete activities:', error)
            return NextResponse.json({
                error: 'Failed to delete activities',
                details: error.message
            }, { status: 500 })
        }

        console.log(`Deleted ${count} activities for athlete ${athlete.id}`)

        return NextResponse.json({
            success: true,
            message: `Deleted ${count || 0} activities`,
            count: count || 0
        })
    } catch (error) {
        console.error('Delete activities error:', error)
        return NextResponse.json(
            { error: 'Failed to delete activities', details: String(error) },
            { status: 500 }
        )
    }
}
