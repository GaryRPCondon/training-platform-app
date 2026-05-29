import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  deleteSession,
  getSessionById,
  loadExerciseCatalog,
  updateSessionCompletion,
  updateSessionExercises,
} from '@/lib/supabase/strength-queries'
import { updateSessionSchema } from '@/lib/strength/schemas'
import { buildCatalogLookup, resolveExerciseAgainstCatalog } from '@/lib/strength/exercise-mapper'
import type { StrengthExercise, StrengthSession } from '@/types/database'

interface Ctx { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params
  const sessionId = Number(id)
  if (!Number.isFinite(sessionId)) {
    return NextResponse.json({ error: 'Invalid session id' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const session = await getSessionById(supabase, user.id, sessionId)
    if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ session })
  } catch (err) {
    console.error('Strength session get error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load session' },
      { status: 500 },
    )
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params
  const sessionId = Number(id)
  if (!Number.isFinite(sessionId)) {
    return NextResponse.json({ error: 'Invalid session id' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = updateSessionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Ownership check up-front so we return 404 cleanly when the row doesn't exist
  // or belongs to another athlete.
  const existing = await getSessionById(supabase, user.id, sessionId)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { exercises, ...completionPatch } = parsed.data

  try {
    let session: StrengthSession = existing
    if (exercises !== undefined) {
      const catalog = await loadExerciseCatalog(supabase)
      const lookup = buildCatalogLookup(catalog)
      const resolved = exercises.map(ex => resolveExerciseAgainstCatalog(ex as StrengthExercise, lookup))
      session = await updateSessionExercises(supabase, user.id, sessionId, resolved)
    }
    if (Object.keys(completionPatch).length > 0) {
      session = await updateSessionCompletion(supabase, user.id, sessionId, completionPatch)
    }
    return NextResponse.json({ session })
  } catch (err) {
    console.error('Strength session update error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update session' },
      { status: 500 },
    )
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params
  const sessionId = Number(id)
  if (!Number.isFinite(sessionId)) {
    return NextResponse.json({ error: 'Invalid session id' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await deleteSession(supabase, user.id, sessionId)
    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to delete session'
    const status = msg === 'Session not found' ? 404 : 500
    if (status === 500) console.error('Strength session delete error:', err)
    return NextResponse.json({ error: msg }, { status })
  }
}
