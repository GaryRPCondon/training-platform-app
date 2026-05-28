/**
 * Strength Program Re-validation
 *
 * POST /api/strength/revalidate
 *   Body: { parsed_program: ParsedProgram }
 *   Returns: { program: ParsedProgram, changes: { exerciseIndex, sessionIndex, before, after }[] }
 *
 * The import wizard's "Edit JSON" escape hatch lets users mutate fields like
 * `garmin_supported` directly — those edits are not trustworthy until the
 * server re-runs each exercise through `resolveExerciseAgainstCatalog`. This
 * endpoint exists so the client can re-stamp Garmin fields after a manual edit
 * without losing the catalog as the source of truth.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { loadExerciseCatalog } from '@/lib/supabase/strength-queries'
import { buildCatalogLookup, resolveExerciseAgainstCatalog } from '@/lib/strength/exercise-mapper'
import { parsedProgramSchema } from '@/lib/strength/schemas'
import type { StrengthExercise } from '@/types/database'

const revalidateRequestSchema = z.object({
  parsed_program: parsedProgramSchema,
})

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = revalidateRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const catalog = await loadExerciseCatalog(supabase)
  const lookup = buildCatalogLookup(catalog)

  const changes: Array<{
    sessionIndex: number
    exerciseIndex: number
    canonical_name: string
    before: { garmin_supported: boolean }
    after: { garmin_supported: boolean; reason?: string }
  }> = []

  const sessions = parsed.data.parsed_program.sessions.map(session => ({
    ...session,
    exercises: session.exercises.map((ex, exerciseIndex) => {
      const resolved = resolveExerciseAgainstCatalog(ex as StrengthExercise, lookup)
      if (resolved.garmin_supported !== ex.garmin_supported) {
        changes.push({
          sessionIndex: session.session_index,
          exerciseIndex,
          canonical_name: ex.canonical_name,
          before: { garmin_supported: ex.garmin_supported },
          after: {
            garmin_supported: resolved.garmin_supported,
            reason: resolved.garmin_unsupported_reason,
          },
        })
      }
      return resolved
    }),
  }))

  return NextResponse.json({
    program: { ...parsed.data.parsed_program, sessions },
    changes,
  })
}
