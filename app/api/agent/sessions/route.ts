import { NextResponse } from 'next/server'
import { getRecentSessions } from '@/lib/agent/session-manager'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const sessions = await getRecentSessions(user.id, supabase)

        return NextResponse.json({ sessions })
    } catch (error) {
        console.error('Failed to load sessions:', error)
        return NextResponse.json({ error: 'Failed to load sessions' }, { status: 500 })
    }
}
