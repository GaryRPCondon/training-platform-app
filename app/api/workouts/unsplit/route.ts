import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const unsplitSchema = z.object({
  workoutId: z.number().int(),
})

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const parsed = unsplitSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
    }
    const { workoutId } = parsed.data

    const { data: workout, error: fetchError } = await supabase
      .from('planned_workouts')
      .select('*')
      .eq('id', workoutId)
      .eq('athlete_id', user.id)
      .single()
    if (fetchError || !workout) {
      return NextResponse.json({ error: 'Workout not found' }, { status: 404 })
    }

    const { data: dayRows, error: daysError } = await supabase
      .from('planned_workouts')
      .select('*')
      .eq('athlete_id', user.id)
      .eq('scheduled_date', workout.scheduled_date)
      .order('session_order', { ascending: true })
    if (daysError || !dayRows) {
      console.error('Unsplit: failed to load same-date rows', daysError)
      return NextResponse.json({ error: 'Failed to merge workouts' }, { status: 500 })
    }

    if (dayRows.length !== 2) {
      return NextResponse.json({
        error: `Cannot merge: expected exactly 2 sessions on this date, found ${dayRows.length}`,
      }, { status: 400 })
    }

    const [run1, run2] = dayRows
    const summed = (run1.distance_target_meters ?? 0) + (run2.distance_target_meters ?? 0)
    if (summed <= 0) {
      return NextResponse.json({ error: 'Cannot merge: sessions have no distance' }, { status: 400 })
    }

    const canonical = run1
    const intensity = canonical.intensity_target ?? 'easy'

    const merged = {
      weekly_plan_id: canonical.weekly_plan_id,
      athlete_id: canonical.athlete_id,
      scheduled_date: canonical.scheduled_date,
      scheduled_time: canonical.scheduled_time,
      workout_type: canonical.workout_type,
      workout_index: canonical.workout_index,
      session_order: 1,
      description: canonical.description,
      distance_target_meters: summed,
      duration_target_seconds: null,
      intensity_target: intensity,
      structured_workout: { pace_guidance: intensity, notes: null },
      status: 'scheduled',
      notes: canonical.notes,
      version: 1,
      garmin_workout_id: null,
      garmin_scheduled_at: null,
      garmin_sync_status: null,
    }

    const snapshots = [run1, run2]

    const { error: deleteError } = await supabase
      .from('planned_workouts')
      .delete()
      .in('id', [run1.id, run2.id])
    if (deleteError) {
      console.error('Unsplit: failed to delete sessions', deleteError)
      return NextResponse.json({ error: 'Failed to merge workouts' }, { status: 500 })
    }

    const { data: inserted, error: insertError } = await supabase
      .from('planned_workouts')
      .insert([merged])
      .select()
      .single()
    if (insertError || !inserted) {
      console.error('Unsplit: failed to insert merged row, restoring', insertError)
      const { error: restoreError } = await supabase
        .from('planned_workouts')
        .insert(snapshots)
      if (restoreError) {
        console.error('Unsplit: restore also failed — manual cleanup required', restoreError)
      }
      return NextResponse.json({ error: 'Failed to merge workouts' }, { status: 500 })
    }

    return NextResponse.json({ success: true, workout: inserted })
  } catch (error) {
    console.error('Unsplit error:', error)
    return NextResponse.json({ error: 'Failed to merge workouts' }, { status: 500 })
  }
}
