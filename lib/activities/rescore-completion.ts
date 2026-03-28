/**
 * Re-score completion for an already-linked workout.
 * Thin wrapper around scoreWorkoutCompletion from scoring.ts.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { scoreWorkoutCompletion } from '@/lib/activities/scoring'

export async function rescoreCompletion(
  supabase: SupabaseClient,
  activityId: number,
  workoutId: number
): Promise<void> {
  const { data: activity } = await supabase
    .from('activities')
    .select('*')
    .eq('id', activityId)
    .single()

  const { data: workout } = await supabase
    .from('planned_workouts')
    .select('*')
    .eq('id', workoutId)
    .single()

  if (!activity || !workout) return

  const result = await scoreWorkoutCompletion(supabase, activity, workout)

  await supabase
    .from('planned_workouts')
    .update({
      completion_status: result.completionStatus,
      completion_metadata: result.completionMetadata,
    })
    .eq('id', workoutId)
}
