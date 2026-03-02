import type { ParsedWorkout, PreWeekWorkout } from './response-parser'

type WorkoutInput = {
  type: string
  distance_meters?: number | null
  intensity: string
  pace_guidance?: string | null
  notes?: string | null
  structured_workout?: Record<string, unknown> | null
}

/**
 * Build the full structured_workout object from workout fields.
 *
 * The LLM only outputs main_set for interval workouts; warmup/cooldown and
 * all other structured_workout fields are derived deterministically here.
 */
export function buildStructuredWorkout(workout: WorkoutInput): Record<string, unknown> {
  const pace_guidance = workout.pace_guidance ?? null
  const notes = workout.notes ?? null

  switch (workout.type) {
    case 'intervals': {
      const main_set = workout.structured_workout?.main_set ?? []
      return {
        warmup: { duration_minutes: 15, intensity: 'easy' },
        main_set,
        cooldown: { duration_minutes: 10, intensity: 'easy' },
        pace_guidance,
        notes,
      }
    }
    case 'tempo': {
      const intervalIntensity = workout.intensity === 'marathon' ? 'marathon' : 'tempo'
      return {
        warmup: { duration_minutes: 10, intensity: 'easy' },
        main_set: [{
          repeat: 1,
          intervals: [{ distance_meters: workout.distance_meters ?? 0, intensity: intervalIntensity }],
        }],
        cooldown: { duration_minutes: 10, intensity: 'easy' },
        pace_guidance,
        notes,
      }
    }
    default:
      // easy_run, recovery, long_run, rest, cross_training, race
      return { pace_guidance, notes }
  }
}

/**
 * Enrich parsed workouts with full structured_workout data.
 * Description, pace_guidance, and notes come from the LLM — only
 * structured_workout is built server-side.
 */
export function enrichParsedWorkouts(workouts: ParsedWorkout[]): void {
  for (const w of workouts) {
    w.structured_workout = buildStructuredWorkout(w)
  }
}

export function enrichPreWeekWorkouts(workouts: PreWeekWorkout[]): void {
  for (const w of workouts) {
    w.structured_workout = buildStructuredWorkout(w)
  }
}
