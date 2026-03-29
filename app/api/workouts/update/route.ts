import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { rescoreCompletion } from '@/lib/activities/rescore-completion'
import {
  scaleStructuredWorkoutDistance,
  getMainSetDistance,
  rebuildStructuredWorkoutForType,
} from '@/lib/plans/structured-workout-builder'
import { calculateTotalWorkoutDistance } from '@/lib/training/vdot'

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

    // ---------------------------------------------------------------
    // Auto-sync structured_workout ↔ distance_target_meters
    // ---------------------------------------------------------------
    const currentSw = workout.structured_workout as Record<string, unknown> | null
    const currentType = workout.workout_type as string
    const hasMainSet = currentSw?.main_set !== undefined

    const swChanged = 'structured_workout' in updateData
    const distChanged = 'distance_target_meters' in updateData
    const typeChanged = 'workout_type' in updateData

    if (typeChanged && !swChanged) {
      // Type changed → rebuild structured workout for the new type
      const newType = updateData.workout_type as string
      const dist = distChanged
        ? updateData.distance_target_meters
        : workout.distance_target_meters
      const intensity = workout.intensity_target ?? 'moderate'
      updateData.structured_workout = rebuildStructuredWorkoutForType(newType, dist, intensity)
    } else if (swChanged && !distChanged) {
      // Structured workout changed → recalculate distance from it
      const newSw = updateData.structured_workout as Record<string, unknown> | null
      const effectiveType = typeChanged ? updateData.workout_type : currentType
      if (newSw?.main_set !== undefined) {
        const total = calculateTotalWorkoutDistance(
          null, // force calculation from structure
          effectiveType,
          newSw,
          null
        )
        if (total > 0) {
          updateData.distance_target_meters = total
        }
      }
    } else if (distChanged && !swChanged && hasMainSet) {
      // Distance changed on a structured workout → scale intervals proportionally
      const oldDistance = workout.distance_target_meters as number
      const newDistance = updateData.distance_target_meters as number
      if (oldDistance && oldDistance > 0 && newDistance && newDistance > 0 && currentSw) {
        // Calculate the main-set-only distance for proportional scaling
        const oldMainSetDist = getMainSetDistance(currentSw)
        if (oldMainSetDist > 0) {
          const factor = newDistance / oldDistance
          updateData.structured_workout = scaleStructuredWorkoutDistance(currentSw, factor)
        }
      }
    }
    // If both changed together → trust what was sent (user explicitly set both)

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

    // Re-score completion if workout has a linked activity (targets may have changed)
    if (updated.completed_activity_id) {
      try {
        await rescoreCompletion(supabase, updated.completed_activity_id, updated.id)
      } catch (e) {
        console.error('Failed to re-score completion:', e)
        // Non-fatal — the update itself succeeded
      }
    }

    return NextResponse.json({ success: true, workout: updated })
  } catch (error) {
    console.error('Workout update error:', error)
    return NextResponse.json({ error: 'Failed to update workout' }, { status: 500 })
  }
}
