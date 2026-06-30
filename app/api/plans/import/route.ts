import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createImportRequestSchema } from '@/lib/plans/import/schemas'
import {
  insertImportedRunPlan,
  listImportedRunPlans,
  deriveDefaultDaysPerWeek,
} from '@/lib/supabase/import-run-plan-queries'

// GET — list the athlete's private imported-plan library.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const plans = await listImportedRunPlans(supabase, user.id)
    return NextResponse.json({ plans })
  } catch (err) {
    console.error('Imported run plans list error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to list imported plans' },
      { status: 500 },
    )
  }
}

// POST — accept a reviewed plan: persist the definition only. Scheduling it onto
// a race window (LLM-tailored) is a separate step via [id]/generate.
export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = createImportRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { definition } = parsed.data

  try {
    const imported = await insertImportedRunPlan(supabase, user.id, {
      name: parsed.data.name,
      source_type: parsed.data.source_type,
      source_provider: parsed.data.source_provider ?? null,
      source_model: parsed.data.source_model ?? null,
      parse_confidence: parsed.data.parse_confidence ?? null,
      parse_metadata: parsed.data.parse_metadata ?? null,
      definition,
      distance: definition.distance ?? null,
      default_days_per_week: deriveDefaultDaysPerWeek(definition),
      total_weeks: definition.weeks.length,
    })

    return NextResponse.json({ importedRunPlanId: imported.id }, { status: 201 })
  } catch (err) {
    console.error('Imported run plan create error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to import plan' },
      { status: 500 },
    )
  }
}
