import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const SPLITTABLE_TYPES = new Set(['easy_run', 'long_run', 'recovery'])
const TOLERANCE_FRACTION = 0.05

const splitSchema = z.object({
  workoutId: z.number().int(),
  run1Distance: z.number().int().positive(),
  run2Distance: z.number().int().positive(),
})

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const parsed = splitSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
    }
    const { workoutId, run1Distance, run2Distance } = parsed.data

    const { data: workout, error: fetchError } = await supabase
      .from('planned_workouts')
      .select('*')
      .eq('id', workoutId)
      .eq('athlete_id', user.id)
      .single()
    if (fetchError || !workout) {
      return NextResponse.json({ error: 'Workout not found' }, { status: 404 })
    }

    if (!SPLITTABLE_TYPES.has(workout.workout_type)) {
      return NextResponse.json({ error: 'Workout type cannot be split' }, { status: 400 })
    }

    const total = workout.distance_target_meters
    if (!total || total <= 0) {
      return NextResponse.json({ error: 'Workout has no distance target to split' }, { status: 400 })
    }

    const drift = Math.abs((run1Distance + run2Distance) - total)
    if (drift > total * TOLERANCE_FRACTION) {
      return NextResponse.json({
        error: `Split distances must sum within ${Math.round(TOLERANCE_FRACTION * 100)}% of original (${total}m)`,
      }, { status: 400 })
    }

    const { data: siblings } = await supabase
      .from('planned_workouts')
      .select('id')
      .eq('athlete_id', user.id)
      .eq('scheduled_date', workout.scheduled_date)
      .neq('id', workoutId)
    if (siblings && siblings.length > 0) {
      return NextResponse.json({ error: 'Date already has multiple workouts; cannot split' }, { status: 400 })
    }

    const baseDescription = workout.description ?? formatDefaultName(workout.workout_type)
    const intensity = workout.intensity_target ?? 'easy'

    const buildChild = (run: number, distance: number) => ({
      weekly_plan_id: workout.weekly_plan_id,
      athlete_id: workout.athlete_id,
      scheduled_date: workout.scheduled_date,
      scheduled_time: workout.scheduled_time,
      workout_type: workout.workout_type,
      workout_index: workout.workout_index,
      session_order: run,
      description: `${baseDescription} (Run ${run})`,
      distance_target_meters: distance,
      duration_target_seconds: null,
      intensity_target: intensity,
      structured_workout: { pace_guidance: intensity, notes: `Run ${run} of 2` },
      status: 'scheduled',
      notes: workout.notes,
      version: 1,
      garmin_workout_id: null,
      garmin_scheduled_at: null,
      garmin_sync_status: null,
    })

    const originalSnapshot = { ...workout }

    const { error: deleteError } = await supabase
      .from('planned_workouts')
      .delete()
      .eq('id', workoutId)
    if (deleteError) {
      console.error('Split: failed to delete original', deleteError)
      return NextResponse.json({ error: 'Failed to split workout' }, { status: 500 })
    }

    const { data: inserted, error: insertError } = await supabase
      .from('planned_workouts')
      .insert([buildChild(1, run1Distance), buildChild(2, run2Distance)])
      .select()
    if (insertError || !inserted || inserted.length !== 2) {
      console.error('Split: failed to insert children, attempting restore', insertError)
      const { error: restoreError } = await supabase
        .from('planned_workouts')
        .insert([originalSnapshot])
      if (restoreError) {
        console.error('Split: restore also failed — manual cleanup required', restoreError)
      }
      return NextResponse.json({ error: 'Failed to split workout' }, { status: 500 })
    }

    return NextResponse.json({ success: true, workouts: inserted })
  } catch (error) {
    console.error('Split error:', error)
    return NextResponse.json({ error: 'Failed to split workout' }, { status: 500 })
  }
}

function formatDefaultName(type: string): string {
  return type.split('_').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ')
}
