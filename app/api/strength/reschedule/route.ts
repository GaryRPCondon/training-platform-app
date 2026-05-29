import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { loadExerciseCatalog, rescheduleSession } from '@/lib/supabase/strength-queries'
import { rescheduleSessionSchema } from '@/lib/strength/schemas'
import { GarminClient } from '@/lib/garmin/client'
import { mapStrengthSessionToGarmin } from '@/lib/garmin/strength-workout-mapper'
import type { StrengthSession } from '@/types/database'

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = rescheduleSessionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Capture pre-update Garmin state so we know whether to attempt an
  // auto-reschedule on Garmin Connect after the date is moved.
  const { data: preRow } = await supabase
    .from('strength_sessions')
    .select('garmin_workout_id, garmin_sync_status')
    .eq('id', parsed.data.sessionId)
    .eq('athlete_id', user.id)
    .maybeSingle()
  const wasSynced = !!preRow?.garmin_workout_id && preRow.garmin_sync_status === 'synced'
  const garminWorkoutId = preRow?.garmin_workout_id ?? null

  let session: StrengthSession
  try {
    session = await rescheduleSession(supabase, user.id, parsed.data.sessionId, parsed.data.newDate)
  } catch (err) {
    console.error('Strength reschedule error:', err)
    const msg = err instanceof Error ? err.message : 'Failed to reschedule'
    const status = msg.toLowerCase().includes('no rows') || msg.includes('not found') ? 404 : 500
    return NextResponse.json({ error: msg }, { status })
  }

  // Best-effort: if the session was previously synced to Garmin, move it on
  // Garmin's calendar too. Garmin's `/workout-service/schedule/{workoutId}`
  // endpoint *stacks* schedule entries (verified 2026-05-29) rather than
  // replacing the prior date, so a naive re-POST leaves a ghost on the old
  // date. To get clean move semantics we delete the old Garmin workout
  // entirely — which removes all its schedule entries — and create a fresh
  // one on the new date.
  //
  // NOTE: the create-and-schedule block below duplicates the core of
  // `handleSend` in app/api/garmin/strength-workouts/route.ts. Extract a
  // shared helper when Stage 5 (AI coach strength tools) needs the same
  // primitive.
  let garminMoved = false
  let garminError: string | undefined
  if (wasSynced && garminWorkoutId) {
    try {
      const garminClient = new GarminClient()
      garminClient.init(supabase, user.id)
      await garminClient['ensureAuthenticated']()

      // Delete the old Garmin workout; tolerate 404 (already gone on Garmin).
      try {
        await garminClient.deleteWorkout(garminWorkoutId)
      } catch (delErr) {
        const is404 = delErr instanceof Error && delErr.message.includes('404')
        if (!is404) throw delErr
      }

      // Clear pointers so the row is in a "not synced" state during the
      // recreation; if any step below fails the row stays clean rather than
      // pointing at a deleted Garmin workout.
      await supabase
        .from('strength_sessions')
        .update({
          garmin_workout_id: null,
          garmin_scheduled_at: null,
          garmin_sync_status: null,
        })
        .eq('id', parsed.data.sessionId)
        .eq('athlete_id', user.id)

      const catalog = await loadExerciseCatalog(supabase)
      const { payload } = mapStrengthSessionToGarmin(session, catalog)
      const created = await garminClient.createWorkout(payload)
      const newWorkoutId = String(created.workoutId)
      await garminClient.scheduleWorkout(newWorkoutId, parsed.data.newDate)

      const { data: updated } = await supabase
        .from('strength_sessions')
        .update({
          garmin_workout_id: newWorkoutId,
          garmin_scheduled_at: new Date().toISOString(),
          garmin_sync_status: 'synced',
        })
        .eq('id', parsed.data.sessionId)
        .eq('athlete_id', user.id)
        .select('*')
        .single()
      if (updated) session = { ...session, ...(updated as StrengthSession) }
      garminMoved = true
    } catch (err) {
      garminError = err instanceof Error ? err.message : 'Garmin update failed'
      console.error('Strength Garmin auto-reschedule failed:', err)
    }
  }

  return NextResponse.json({ session, garminMoved, garminError })
}
