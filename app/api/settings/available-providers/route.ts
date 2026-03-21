import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const PROVIDER_ENV_MAP: Record<string, string> = {
    deepseek: 'DEEPSEEK_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    gemini: 'GEMINI_API_KEY',
    grok: 'XAI_API_KEY',
}

export async function GET() {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const providers = Object.entries(PROVIDER_ENV_MAP).map(([name, envVar]) => ({
            name,
            available: !!process.env[envVar],
        }))

        return NextResponse.json({ providers })
    } catch {
        return NextResponse.json({ error: 'Failed to check providers' }, { status: 500 })
    }
}
