import { NextResponse } from 'next/server'
import { getChatSession } from '@/lib/agent/session-manager'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url)
        const sessionId = searchParams.get('sessionId')

        if (!sessionId) {
            return NextResponse.json({ error: 'Session ID required' }, { status: 400 })
        }

        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const session = await getChatSession(parseInt(sessionId), supabase)

        // Verify session belongs to user
        if (session.athlete_id !== user.id) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
        }

        return NextResponse.json({
            messages: session.messages.map(m => ({
                id: m.id,
                role: m.role,
                content: m.content,
                action_taken: m.action_taken ?? null,
            }))
        })
    } catch (error) {
        console.error('Failed to load chat history:', error)
        return NextResponse.json({ error: 'Failed to load history' }, { status: 500 })
    }
}
