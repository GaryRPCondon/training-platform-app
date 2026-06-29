import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createImportRequestSchema } from '@/lib/plans/import/schemas'
import {
  insertImportedRunPlan,
  listImportedRunPlans,
  deriveDefaultDaysPerWeek,
} from '@/lib/supabase/import-run-plan-queries'
import { applyImportedPlan } from '@/lib/plans/import/apply'
import { loadAthletePaces } from '@/lib/plans/import/athlete-paces'

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

// POST — accept a reviewed plan: persist the definition, then materialize a
// first training_plans draft fitted to the chosen window/race.
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
  if (parsed.data.race_date <= parsed.data.start_date) {
    return NextResponse.json(
      { error: 'race_date must be after start_date' },
      { status: 400 },
    )
  }

  try {
    const { athletePaces, vdot } = await loadAthletePaces(supabase, user.id)

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

    const result = await applyImportedPlan({
      supabase,
      athleteId: user.id,
      definition,
      name: parsed.data.name,
      startDate: parsed.data.start_date,
      raceDate: parsed.data.race_date,
      raceDistance: parsed.data.race_distance,
      importedRunPlanId: imported.id,
      athletePaces,
      vdot,
    })

    return NextResponse.json(
      { importedRunPlanId: imported.id, ...result },
      { status: 201 },
    )
  } catch (err) {
    console.error('Imported run plan create error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to import plan' },
      { status: 500 },
    )
  }
}
