/**
 * Garmin Strength Workout Export
 *
 * POST /api/garmin/strength-workouts
 *   Body: { sessionIds: number[], action: 'send' | 'delete' }
 *
 * Mirrors /api/garmin/workouts/route.ts but operates on the strength_sessions
 * table. See lib/garmin/strength-workout-mapper.ts for payload shape.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { GarminClient } from '@/lib/garmin/client'
import { mapStrengthSessionToGarmin, type ExerciseMappingNote } from '@/lib/garmin/strength-workout-mapper'
import { loadExerciseCatalog } from '@/lib/supabase/strength-queries'
import type { StrengthSession } from '@/types/database'

const DELAY_BETWEEN_REQUESTS_MS = 500

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const strengthWorkoutSchema = z.object({
  action: z.enum(['send', 'delete']),
  sessionIds: z.array(z.number().int().min(1)).min(1),
})

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const parsed = strengthWorkoutSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 },
      )
    }
    const { sessionIds, action } = parsed.data

    const garminClient = new GarminClient()
    garminClient.init(supabase, user.id)
    try {
      await garminClient['ensureAuthenticated']()
    } catch {
      return NextResponse.json(
        { error: 'Garmin not connected. Please authenticate in Settings first.' },
        { status: 401 },
      )
    }

    if (action === 'delete') {
      return handleDelete(supabase, user.id, sessionIds, garminClient)
    }
    return handleSend(supabase, user.id, sessionIds, garminClient)
  } catch (error) {
    console.error('Garmin strength workout export error:', error)
    return NextResponse.json({ error: 'Failed to export strength workouts to Garmin' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

async function handleDelete(
  supabase: Awaited<ReturnType<typeof createClient>>,
  athleteId: string,
  sessionIds: number[],
  garminClient: GarminClient,
) {
  const { data: toDelete, error: fetchErr } = await supabase
    .from('strength_sessions')
    .select('id, garmin_workout_id')
    .eq('athlete_id', athleteId)
    .in('id', sessionIds)
    .not('garmin_workout_id', 'is', null)

  if (fetchErr) {
    return NextResponse.json({ error: 'Failed to load sessions' }, { status: 500 })
  }

  const results = { deleted: 0, failed: 0, errors: [] as Array<{ sessionId: number; error: string }> }

  for (const session of toDelete ?? []) {
    try {
      await garminClient.deleteWorkout(session.garmin_workout_id!)
      await clearGarminFields(supabase, session.id)
      results.deleted++
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error'
      if (errMsg.includes('404')) {
        // Already gone from Garmin — clear our pointer and count as success.
        await clearGarminFields(supabase, session.id)
        results.deleted++
      } else {
        results.failed++
        results.errors.push({ sessionId: session.id, error: errMsg })
      }
    }
    await sleep(DELAY_BETWEEN_REQUESTS_MS)
  }

  return NextResponse.json(results)
}

async function clearGarminFields(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sessionId: number,
) {
  await supabase
    .from('strength_sessions')
    .update({
      garmin_workout_id: null,
      garmin_sync_status: null,
      garmin_scheduled_at: null,
    })
    .eq('id', sessionId)
}

// ---------------------------------------------------------------------------
// SEND
// ---------------------------------------------------------------------------

async function handleSend(
  supabase: Awaited<ReturnType<typeof createClient>>,
  athleteId: string,
  sessionIds: number[],
  garminClient: GarminClient,
) {
  const [{ data: sessions, error: sessionsError }, catalog] = await Promise.all([
    supabase
      .from('strength_sessions')
      .select('*')
      .in('id', sessionIds)
      .eq('athlete_id', athleteId)
      .returns<StrengthSession[]>(),
    loadExerciseCatalog(supabase),
  ])

  if (sessionsError || !sessions) {
    return NextResponse.json({ error: 'Failed to load sessions' }, { status: 500 })
  }

  const results = {
    sent: 0,
    failed: 0,
    skipped: 0,
    errors: [] as Array<{ sessionId: number; error: string }>,
    // Per-session mapping notes so the UI can surface "X exercises sent as
    // generic fallback / label-only" without re-running the mapper.
    sessionMappings: [] as Array<{ sessionId: number; mappings: ExerciseMappingNote[] }>,
  }

  for (const session of sessions) {
    try {
      if (session.exercises.length === 0) {
        results.skipped++
        results.errors.push({ sessionId: session.id, error: 'Session has no exercises' })
        continue
      }

      const { payload, mappings } = mapStrengthSessionToGarmin(session, catalog)
      results.sessionMappings.push({ sessionId: session.id, mappings })

      let garminWorkoutId: string
      let needsSchedule = false

      if (session.garmin_workout_id) {
        try {
          await garminClient.updateWorkout(session.garmin_workout_id, payload)
          garminWorkoutId = session.garmin_workout_id
        } catch (updateErr) {
          const is404 = updateErr instanceof Error && updateErr.message.includes('404')
          if (!is404) throw updateErr
          const created = await garminClient.createWorkout(payload)
          garminWorkoutId = String(created.workoutId)
          needsSchedule = true
        }
      } else {
        const created = await garminClient.createWorkout(payload)
        garminWorkoutId = String(created.workoutId)
        needsSchedule = true
      }

      await sleep(DELAY_BETWEEN_REQUESTS_MS)

      // Persist the workout ID immediately so re-sends update in place even
      // if the schedule call below fails.
      await supabase
        .from('strength_sessions')
        .update({ garmin_workout_id: garminWorkoutId })
        .eq('id', session.id)

      if (needsSchedule) {
        try {
          await garminClient.scheduleWorkout(garminWorkoutId, session.scheduled_date)
        } catch {
          await sleep(2000)
          await garminClient.scheduleWorkout(garminWorkoutId, session.scheduled_date)
        }
        await sleep(DELAY_BETWEEN_REQUESTS_MS)
      }

      await supabase
        .from('strength_sessions')
        .update({
          garmin_scheduled_at: new Date().toISOString(),
          garmin_sync_status: 'synced',
        })
        .eq('id', session.id)

      results.sent++
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error'
      console.error(`Failed to send strength session ${session.id} to Garmin:`, error)

      await supabase
        .from('strength_sessions')
        .update({ garmin_sync_status: 'failed' })
        .eq('id', session.id)
        .eq('athlete_id', athleteId)

      results.failed++
      results.errors.push({ sessionId: session.id, error: errMsg })

      if (errMsg.includes('rate limit')) {
        return NextResponse.json({
          ...results,
          rateLimitHit: true,
          message: 'Rate limit reached. Remaining sessions were not sent.',
        })
      }
    }
  }

  return NextResponse.json(results)
}

