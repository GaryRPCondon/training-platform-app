import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseStrengthProgram, ParseFailedError } from '@/lib/strength/parser'
import { loadExerciseCatalog } from '@/lib/supabase/strength-queries'
import { parseRequestSchema } from '@/lib/strength/schemas'

export async function POST(request: Request) {
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

  const catalog = await loadExerciseCatalog(supabase)

  // Parsing is pure extraction — thinking buys nothing and its reasoning
  // tokens compete with the JSON output budget. When Gemini is selected with
  // no explicit model, pin Flash Lite (non-thinking, cheaper). Mirrors the
  // plan-gen / AI-summary pattern.
  const parseModel = (athlete?.preferred_llm_provider === 'gemini' && !athlete?.preferred_llm_model)
    ? 'gemini-2.5-flash-lite'
    : (athlete?.preferred_llm_model ?? undefined)

  try {
    const result = await parseStrengthProgram({
      text: parsed.data.text,
      source_format: parsed.data.source_format,
      providerName: athlete?.preferred_llm_provider ?? undefined,
      modelName: parseModel,
      catalog,
    })

    return NextResponse.json({
      program: result.program,
      confidence: result.confidence,
      contentType: result.contentType,
      warnings: result.warnings,
      model: result.model,
      usage: {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      },
    })
  } catch (err) {
    if (err instanceof ParseFailedError) {
      return NextResponse.json(
        { error: err.message, details: err.details },
        { status: 422 },
      )
    }
    console.error('Strength parse error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Parse failed' },
      { status: 500 },
    )
  }
}
