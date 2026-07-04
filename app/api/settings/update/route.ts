import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ensureAthleteExists } from '@/lib/supabase/ensure-athlete'
import { isLocale } from '@/i18n/config'
import { isDemoUser } from '@/lib/demo/demo'
import { z } from 'zod'

/**
 * Personal-preference fields the shared demo account is allowed to change.
 * Everything else (name/identity, LLM provider + model = cost, vision, push /
 * summary settings) is stripped for the demo user so the account can't be
 * defaced or made to run up cost. This is the server-side guarantee — the
 * Settings UI additionally disables those inputs for the demo account.
 */
const DEMO_ALLOWED_FIELDS = new Set(['preferred_units', 'week_starts_on', 'locale'])

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
    vision_provider: z.enum(['anthropic', 'openai', 'gemini']).optional(),
    vision_model: z.string().max(100).nullable().optional(),
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
    feedback_tone: z.enum(['critical', 'balanced', 'positive']).optional(),
    locale: z.string().refine(isLocale, 'Unsupported locale').optional(),
})

export async function POST(request: Request) {
    try {
        const body = await request.json()
        const parsed = settingsSchema.safeParse(body)
        if (!parsed.success) {
            return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
        }
        const { provider, model, vision_provider, vision_model, preferred_units, week_starts_on, useFastModelForOperations, preferred_activity_data_source, first_name, last_name, profile_completed, sync_on_login, ai_summaries_enabled, push_summary_to_garmin, push_summary_to_strava, feedback_tone, locale } = parsed.data

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

        if (vision_provider !== undefined) {
            const envVar = PROVIDER_ENV_MAP[vision_provider]
            if (envVar && !process.env[envVar]) {
                return NextResponse.json(
                    { error: `The ${vision_provider} provider is not available on this instance.` },
                    { status: 400 }
                )
            }
        }

        // Build update object with only provided fields
        const updates: Record<string, unknown> = {}
        if (provider !== undefined) updates.preferred_llm_provider = provider
        if (model !== undefined) updates.preferred_llm_model = model || null
        if (vision_provider !== undefined) updates.preferred_vision_provider = vision_provider
        if (vision_model !== undefined) updates.preferred_vision_model = vision_model || null
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
        if (feedback_tone !== undefined) updates.feedback_tone = feedback_tone
        if (locale !== undefined) updates.locale = locale

        // Demo account: keep only the harmless personal preferences. Strip
        // identity/cost fields even if the request carries them (e.g. crafted
        // directly against the API). Keyed off the env-based isDemoUser check,
        // not the DB is_demo column, so it can't be bypassed via supabase-js.
        if (isDemoUser(user.id)) {
            for (const key of Object.keys(updates)) {
                if (!DEMO_ALLOWED_FIELDS.has(key)) delete updates[key]
            }
        }

        // Nothing left to write (e.g. a demo request that carried only stripped
        // fields) — succeed without issuing an empty UPDATE.
        if (Object.keys(updates).length === 0) {
            return NextResponse.json({ success: true })
        }

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
