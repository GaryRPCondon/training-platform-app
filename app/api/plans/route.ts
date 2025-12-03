import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
    try {
        const supabase = await createClient()

        // Get current user
        const { data: { user }, error: userError } = await supabase.auth.getUser()
        if (userError || !user) {
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
        }

        // Fetch all plans for this athlete
        const { data: plans, error } = await supabase
            .from('training_plans')
            .select('*')
            .eq('athlete_id', user.id)
            .order('created_at', { ascending: false })

        if (error) {
            console.error('Error fetching plans:', error)
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json({ plans })
    } catch (error) {
        console.error('Error in plans API:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
