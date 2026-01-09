import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ensureAthleteExists } from '@/lib/supabase/ensure-athlete'

export async function POST(request: Request) {
    try {
        const body = await request.json()
        const { provider, model, preferred_units, week_starts_on, useFastModelForOperations, preferred_activity_data_source, first_name, last_name } = body

        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { athleteId, error: athleteError } = await ensureAthleteExists(supabase, user.id, user.email)

        if (athleteError) {
            return NextResponse.json({ error: athleteError }, { status: 500 })
        }

        // Build update object with only provided fields
        const updates: any = {}
        if (provider !== undefined) updates.preferred_llm_provider = provider
        if (model !== undefined) updates.preferred_llm_model = model || null
        if (preferred_units !== undefined) updates.preferred_units = preferred_units
        if (week_starts_on !== undefined) updates.week_starts_on = week_starts_on
        if (useFastModelForOperations !== undefined) updates.use_fast_model_for_operations = useFastModelForOperations
        if (preferred_activity_data_source !== undefined) updates.preferred_activity_data_source = preferred_activity_data_source
        if (first_name !== undefined) updates.first_name = first_name
        if (last_name !== undefined) updates.last_name = last_name

        const { error } = await supabase
            .from('athletes')
            .update(updates)
            .eq('id', athleteId)

        if (error) throw error

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Update settings error:', error)
        return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 })
    }
}
