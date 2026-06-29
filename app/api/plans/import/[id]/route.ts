import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  getImportedRunPlan,
  softDeleteImportedRunPlan,
} from '@/lib/supabase/import-run-plan-queries'

interface Ctx { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params
  const planId = Number(id)
  if (!Number.isFinite(planId)) {
    return NextResponse.json({ error: 'Invalid plan id' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const plan = await getImportedRunPlan(supabase, user.id, planId)
    if (!plan) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ plan })
  } catch (err) {
    console.error('Imported run plan get error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load imported plan' },
      { status: 500 },
    )
  }
}

// Soft-delete: hides the definition from the library. Already-materialized
// training_plans created from it are left untouched (provenance FK is ON DELETE
// SET NULL, but we don't hard-delete here anyway).
export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params
  const planId = Number(id)
  if (!Number.isFinite(planId)) {
    return NextResponse.json({ error: 'Invalid plan id' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const deleted = await softDeleteImportedRunPlan(supabase, user.id, planId)
    if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Imported run plan delete error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete imported plan' },
      { status: 500 },
    )
  }
}
