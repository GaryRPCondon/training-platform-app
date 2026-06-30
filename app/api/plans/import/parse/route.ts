import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { withRateLimit } from '@/lib/rate-limit/with-rate-limit'
import { parseRunningPlan, RunPlanParseError } from '@/lib/plans/import/parser'
import { VisionUnavailableError } from '@/lib/agent/vision'
import { parseRequestSchema } from '@/lib/plans/import/schemas'

async function postHandler(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = parseRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: athlete } = await supabase
    .from('athletes')
    .select('preferred_llm_provider, preferred_llm_model')
    .eq('id', user.id)
    .single()

  // Parsing is pure extraction — pin Gemini Flash Lite (non-thinking, cheaper)
  // when Gemini is selected with no explicit model. Mirrors the strength parser.
  const parseModel =
    athlete?.preferred_llm_provider === 'gemini' && !athlete?.preferred_llm_model
      ? 'gemini-2.5-flash-lite'
      : (athlete?.preferred_llm_model ?? undefined)

  try {
    const result = await parseRunningPlan({
      source_type: parsed.data.source_type,
      text: parsed.data.text,
      images: parsed.data.images,
      providerName: athlete?.preferred_llm_provider ?? undefined,
      modelName: parseModel,
    })

    return NextResponse.json({
      plan: result.plan,
      confidence: result.confidence,
      contentType: result.contentType,
      warnings: result.warnings,
      totalWeeks: result.totalWeeks,
      model: result.model,
      usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens },
    })
  } catch (err) {
    if (err instanceof VisionUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    if (err instanceof RunPlanParseError) {
      return NextResponse.json({ error: err.message, details: err.details }, { status: 422 })
    }
    console.error('Run plan parse error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Parse failed' },
      { status: 500 },
    )
  }
}

export const POST = withRateLimit('generation', postHandler)
