import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ensureAthleteExists } from '@/lib/supabase/ensure-athlete'

export async function GET() {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { athleteId, error: athleteError } = await ensureAthleteExists(supabase, user.id, user.email)

        if (athleteError) {
            return NextResponse.json({ error: athleteError }, { status: 500 })
        }

        const { data: athlete } = await supabase
            .from('athletes')
            .select('preferred_llm_provider, preferred_llm_model, use_fast_model_for_operations')
            .eq('id', athleteId)
            .single()

        return NextResponse.json({
            provider: athlete?.preferred_llm_provider || 'deepseek',
            model: athlete?.preferred_llm_model || '',
            useFastModelForOperations: athlete?.use_fast_model_for_operations ?? true // Default to true
        })
    } catch (error) {
        console.error('Get settings error:', error)
        return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 })
    }
}
