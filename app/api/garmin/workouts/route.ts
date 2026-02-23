import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { GarminClient } from '@/lib/garmin/client'
import { mapToGarminWorkout } from '@/lib/garmin/workout-mapper'

const DELAY_BETWEEN_REQUESTS_MS = 500

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { workoutIds, action } = await request.json()

    if (!['send', 'delete', 'delete-all'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    if (action !== 'delete-all' && (!workoutIds || !Array.isArray(workoutIds) || workoutIds.length === 0)) {
      return NextResponse.json({ error: 'workoutIds array required' }, { status: 400 })
    }

    // -------------------------------------------------------------------------
    // DELETE / DELETE-ALL actions
    // -------------------------------------------------------------------------
    if (action === 'delete' || action === 'delete-all') {
      // Resolve the set of workouts to delete
      let query = supabase
        .from('planned_workouts')
        .select('id, garmin_workout_id')
        .eq('athlete_id', user.id)
        .not('garmin_workout_id', 'is', null)

      if (action === 'delete') {
        query = query.in('id', workoutIds)
      }

      const { data: toDelete, error: fetchErr } = await query
      if (fetchErr) {
        return NextResponse.json({ error: 'Failed to load workouts' }, { status: 500 })
      }

      const garminClient = new GarminClient()
      garminClient.init(supabase, user.id)
      try {
        await garminClient['ensureAuthenticated']()
      } catch {
        return NextResponse.json(
          { error: 'Garmin not connected. Please authenticate in Settings first.' },
          { status: 401 }
        )
      }

      const results = { deleted: 0, failed: 0, errors: [] as Array<{ workoutId: number; error: string }> }

      for (const workout of (toDelete ?? [])) {
        try {
          await garminClient.deleteWorkout(workout.garmin_workout_id!)
          await supabase
            .from('planned_workouts')
            .update({ garmin_workout_id: null, garmin_sync_status: null, garmin_scheduled_at: null })
            .eq('id', workout.id)
          results.deleted++
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : 'Unknown error'
          // Treat 404 as success — already gone from Garmin
          if (errMsg.includes('404')) {
            await supabase
              .from('planned_workouts')
              .update({ garmin_workout_id: null, garmin_sync_status: null, garmin_scheduled_at: null })
              .eq('id', workout.id)
            results.deleted++
          } else {
            results.failed++
            results.errors.push({ workoutId: workout.id, error: errMsg })
          }
        }
        await sleep(DELAY_BETWEEN_REQUESTS_MS)
      }

      return NextResponse.json(results)
    }

    // -------------------------------------------------------------------------
    // SEND action (existing logic below)
    // -------------------------------------------------------------------------

    // Load the planned workouts
    const { data: workouts, error: workoutsError } = await supabase
      .from('planned_workouts')
      .select('*')
      .in('id', workoutIds)
      .eq('athlete_id', user.id)

    if (workoutsError || !workouts) {
      return NextResponse.json({ error: 'Failed to load workouts' }, { status: 500 })
    }

    // Load training paces from the active plan
    const { data: activePlan } = await supabase
      .from('training_plans')
      .select('training_paces')
      .eq('athlete_id', user.id)
      .eq('status', 'active')
      .maybeSingle()

    const trainingPaces = activePlan?.training_paces ?? null

    // Initialize Garmin client
    const garminClient = new GarminClient()
    garminClient.init(supabase, user.id)

    // Verify Garmin is connected
    try {
      await garminClient['ensureAuthenticated']()
    } catch {
      return NextResponse.json(
        { error: 'Garmin not connected. Please authenticate in Settings first.' },
        { status: 401 }
      )
    }

    // Process each workout
    const results = {
      sent: 0,
      failed: 0,
      errors: [] as Array<{ workoutId: number; error: string }>,
    }

    for (const workout of workouts) {
      try {
        // Map workout to Garmin format
        const garminPayload = mapToGarminWorkout(workout, trainingPaces)

        let garminWorkoutId: string
        let needsSchedule = false

        if (workout.garmin_workout_id) {
          // Workout already exists in Garmin — update it in place.
          // The existing calendar entry keeps pointing to the same workoutId,
          // so no re-scheduling is needed (avoids duplicate calendar entries).
          try {
            await garminClient.updateWorkout(workout.garmin_workout_id, garminPayload)
            garminWorkoutId = workout.garmin_workout_id
          } catch (updateErr) {
            const is404 = updateErr instanceof Error && updateErr.message.includes('404')
            if (!is404) throw updateErr
            // Workout was deleted from Garmin — create and schedule a new one
            const created = await garminClient.createWorkout(garminPayload)
            garminWorkoutId = String(created.workoutId)
            needsSchedule = true
          }
        } else {
          // First time sending — create and schedule
          const created = await garminClient.createWorkout(garminPayload)
          garminWorkoutId = String(created.workoutId)
          needsSchedule = true
        }

        await sleep(DELAY_BETWEEN_REQUESTS_MS)

        // Persist the workout ID immediately so re-sends update in place
        // even if the schedule call below fails
        await supabase
          .from('planned_workouts')
          .update({ garmin_workout_id: garminWorkoutId })
          .eq('id', workout.id)

        if (needsSchedule) {
          // Retry once on transient failures (token refresh timing, etc.)
          try {
            await garminClient.scheduleWorkout(garminWorkoutId, workout.scheduled_date)
          } catch {
            await sleep(2000)
            await garminClient.scheduleWorkout(garminWorkoutId, workout.scheduled_date)
          }
          await sleep(DELAY_BETWEEN_REQUESTS_MS)
        }

        // Mark fully synced
        await supabase
          .from('planned_workouts')
          .update({
            garmin_scheduled_at: new Date().toISOString(),
            garmin_sync_status: 'synced',
          })
          .eq('id', workout.id)

        results.sent++
      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : 'Unknown error'
        console.error(`Failed to send workout ${workout.id} to Garmin:`, error)

        // Mark as failed in DB
        await supabase
          .from('planned_workouts')
          .update({ garmin_sync_status: 'failed' })
          .eq('id', workout.id)
          .eq('athlete_id', user.id)

        results.failed++
        results.errors.push({
          workoutId: workout.id,
          error: errMsg,
        })

        // Check for rate limit error and stop batch
        if (errMsg.includes('rate limit')) {
          return NextResponse.json({
            ...results,
            rateLimitHit: true,
            message: 'Rate limit reached. Remaining workouts were not sent.',
          })
        }
      }
    }

    return NextResponse.json(results)
  } catch (error) {
    console.error('Garmin workout export error:', error)
    return NextResponse.json({ error: 'Failed to export workouts to Garmin' }, { status: 500 })
  }
}
