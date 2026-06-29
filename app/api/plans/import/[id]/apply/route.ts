import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { applyImportRequestSchema, parsedRunningPlanSchema } from '@/lib/plans/import/schemas'
import { getImportedRunPlan } from '@/lib/supabase/import-run-plan-queries'
import { applyImportedPlan } from '@/lib/plans/import/apply'
import { loadAthletePaces } from '@/lib/plans/import/athlete-paces'

interface Ctx { params: Promise<{ id: string }> }

// Re-apply an existing imported-plan definition onto a new window/race,
// materializing a fresh training_plans draft.
export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params
  const planId = Number(id)
  if (!Number.isFinite(planId)) {
    return NextResponse.json({ error: 'Invalid plan id' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = applyImportRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  if (parsed.data.race_date <= parsed.data.start_date) {
    return NextResponse.json({ error: 'race_date must be after start_date' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const imported = await getImportedRunPlan(supabase, user.id, planId)
    if (!imported) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // The stored definition is trusted JSONB; revalidate so a schema change or
    // manual edit can't feed a malformed plan into the materializer.
    const definition = parsedRunningPlanSchema.parse(imported.definition)

    const { athletePaces, vdot } = await loadAthletePaces(supabase, user.id)

    const result = await applyImportedPlan({
      supabase,
      athleteId: user.id,
      definition,
      name: imported.name,
      startDate: parsed.data.start_date,
      raceDate: parsed.data.race_date,
      raceDistance: parsed.data.race_distance,
      importedRunPlanId: imported.id,
      athletePaces,
      vdot,
    })

    return NextResponse.json({ importedRunPlanId: imported.id, ...result }, { status: 201 })
  } catch (err) {
    console.error('Imported run plan re-apply error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to apply imported plan' },
      { status: 500 },
    )
  }
}
