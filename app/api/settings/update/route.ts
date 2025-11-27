import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ensureAthleteExists } from '@/lib/supabase/ensure-athlete'

export async function POST(request: Request) {
    try {
        const { provider, model } = await request.json()

        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { athleteId, error: athleteError } = await ensureAthleteExists(supabase, user.id, user.email)

        if (athleteError) {
            return NextResponse.json({ error: athleteError }, { status: 500 })
        }

        const { error } = await supabase
            .from('athletes')
            .update({
                preferred_llm_provider: provider,
                preferred_llm_model: model || null
            })
            .eq('id', athleteId)

        if (error) throw error

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Update settings error:', error)
        return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 })
    }
}
