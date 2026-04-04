import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ensureAthleteExists } from '@/lib/supabase/ensure-athlete'
import { z } from 'zod'

const PROVIDER_ENV_MAP: Record<string, string> = {
    deepseek: 'DEEPSEEK_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    gemini: 'GEMINI_API_KEY',
    grok: 'XAI_API_KEY',
}

const settingsSchema = z.object({
    provider: z.enum(['deepseek', 'anthropic', 'openai', 'gemini', 'grok']).optional(),
    model: z.string().max(100).nullable().optional(),
    preferred_units: z.enum(['metric', 'imperial']).optional(),
    week_starts_on: z.number().int().min(0).max(6).optional(),
    useFastModelForOperations: z.boolean().optional(),
    preferred_activity_data_source: z.enum(['strava', 'garmin', 'most_recent']).optional(),
    first_name: z.string().max(100).optional(),
    last_name: z.string().max(100).optional(),
    profile_completed: z.boolean().optional(),
    sync_on_login: z.boolean().optional(),
    ai_summaries_enabled: z.boolean().optional(),
    push_summary_to_garmin: z.boolean().optional(),
    push_summary_to_strava: z.boolean().optional(),
})

export async function POST(request: Request) {
    try {
        const body = await request.json()
        const parsed = settingsSchema.safeParse(body)
        if (!parsed.success) {
            return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
        }
        const { provider, model, preferred_units, week_starts_on, useFastModelForOperations, preferred_activity_data_source, first_name, last_name, profile_completed, sync_on_login, ai_summaries_enabled, push_summary_to_garmin, push_summary_to_strava } = parsed.data

        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { athleteId, error: athleteError } = await ensureAthleteExists(supabase, user.id, user.email)

        if (athleteError) {
            return NextResponse.json({ error: athleteError }, { status: 500 })
        }

        // Validate provider availability before saving
        if (provider !== undefined) {
            const envVar = PROVIDER_ENV_MAP[provider]
            if (envVar && !process.env[envVar]) {
                return NextResponse.json(
                    { error: `The ${provider} provider is not available on this instance.` },
                    { status: 400 }
                )
            }
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
        if (profile_completed !== undefined) updates.profile_completed = profile_completed
        if (sync_on_login !== undefined) updates.sync_on_login = sync_on_login
        if (ai_summaries_enabled !== undefined) updates.ai_summaries_enabled = ai_summaries_enabled
        if (push_summary_to_garmin !== undefined) updates.push_summary_to_garmin = push_summary_to_garmin
        if (push_summary_to_strava !== undefined) updates.push_summary_to_strava = push_summary_to_strava

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
