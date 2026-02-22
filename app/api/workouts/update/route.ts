import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const VALID_INTENSITIES = ['easy', 'moderate', 'hard', 'tempo', 'threshold', 'interval', 'recovery', 'custom']

export async function PATCH(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { workoutId, updates } = await request.json()

    if (!workoutId) {
      return NextResponse.json({ error: 'workoutId required' }, { status: 400 })
    }

    // Fetch current workout to verify ownership and get current version.
    // Using select('*') so this works whether or not the garmin columns migration
    // has been applied yet.
    const { data: workout, error: fetchError } = await supabase
      .from('planned_workouts')
      .select('*')
      .eq('id', workoutId)
      .eq('athlete_id', user.id)
      .single()

    if (fetchError || !workout) {
      if (fetchError) console.error('Workout fetch error:', fetchError)
      return NextResponse.json({ error: 'Workout not found' }, { status: 404 })
    }

    // Validate updates
    const allowedFields = [
      'description',
      'distance_target_meters',
      'intensity_target',
      'duration_target_seconds',
      'structured_workout',
    ]

    const updateData: Record<string, any> = {}

    for (const field of allowedFields) {
      if (field in updates) {
        updateData[field] = updates[field]
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    // Validate individual fields
    if ('distance_target_meters' in updateData) {
      const dist = updateData.distance_target_meters
      if (dist !== null && (typeof dist !== 'number' || dist <= 0)) {
        return NextResponse.json({ error: 'distance_target_meters must be a positive number' }, { status: 400 })
      }
    }

    if ('intensity_target' in updateData) {
      const intensity = updateData.intensity_target
      if (intensity !== null && !VALID_INTENSITIES.includes(intensity)) {
        return NextResponse.json(
          { error: `intensity_target must be one of: ${VALID_INTENSITIES.join(', ')}` },
          { status: 400 }
        )
      }
    }

    if ('duration_target_seconds' in updateData) {
      const dur = updateData.duration_target_seconds
      if (dur !== null && (typeof dur !== 'number' || dur <= 0)) {
        return NextResponse.json({ error: 'duration_target_seconds must be a positive number' }, { status: 400 })
      }
    }

    // Increment version
    updateData.version = workout.version + 1

    // If the workout was previously synced to Garmin, mark it as stale
    if (workout.garmin_workout_id && workout.garmin_sync_status === 'synced') {
      updateData.garmin_sync_status = 'stale'
    }

    const { data: updated, error: updateError } = await supabase
      .from('planned_workouts')
      .update(updateData)
      .eq('id', workoutId)
      .select()
      .single()

    if (updateError) {
      console.error('Failed to update workout:', updateError)
      return NextResponse.json({ error: 'Failed to update workout' }, { status: 500 })
    }

    return NextResponse.json({ success: true, workout: updated })
  } catch (error) {
    console.error('Workout update error:', error)
    return NextResponse.json({ error: 'Failed to update workout' }, { status: 500 })
  }
}
