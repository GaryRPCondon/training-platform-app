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

// ---------------------------------------------------------------------------
// Sync helpers — keep structured_workout ↔ scalar fields consistent
// ---------------------------------------------------------------------------

type StructuredWorkout = Record<string, unknown>

interface MainSetInterval {
  distance_meters?: number
  duration_minutes?: number
  duration_seconds?: number
  intensity?: string
  target_pace?: string
}

interface MainSetGroup {
  repeat?: number
  intervals?: MainSetInterval[]
  skip_last_recovery?: boolean
  distance_meters?: number
  duration_minutes?: number
  duration_seconds?: number
  intensity?: string
  target_pace?: string
}

/**
 * Scale all distance_meters values inside a structured workout proportionally.
 * Returns a new object (does not mutate the input).
 */
export function scaleStructuredWorkoutDistance(
  sw: StructuredWorkout,
  factor: number
): StructuredWorkout {
  const result = { ...sw }

  // Scale warmup distance if present
  if (result.warmup && typeof result.warmup === 'object') {
    const warmup = { ...(result.warmup as MainSetInterval) }
    if (warmup.distance_meters) {
      warmup.distance_meters = Math.round(warmup.distance_meters * factor)
    }
    result.warmup = warmup
  }

  // Scale cooldown distance if present
  if (result.cooldown && typeof result.cooldown === 'object') {
    const cooldown = { ...(result.cooldown as MainSetInterval) }
    if (cooldown.distance_meters) {
      cooldown.distance_meters = Math.round(cooldown.distance_meters * factor)
    }
    result.cooldown = cooldown
  }

  // Scale main_set interval distances
  if (result.main_set) {
    const mainSet = Array.isArray(result.main_set)
      ? (result.main_set as MainSetGroup[])
      : [result.main_set as MainSetGroup]

    result.main_set = mainSet.map(group => {
      const g = { ...group }
      if (g.distance_meters) {
        g.distance_meters = Math.round(g.distance_meters * factor)
      }
      if (g.intervals) {
        g.intervals = g.intervals.map(interval => {
          const i = { ...interval }
          if (i.distance_meters) {
            i.distance_meters = Math.round(i.distance_meters * factor)
          }
          return i
        })
      }
      return g
    })
  }

  return result
}

/**
 * Calculate the total main_set distance from a structured workout.
 * Only counts distance_meters in interval groups (repeat × interval distances).
 * Does NOT include warmup/cooldown (those are time-based).
 */
export function getMainSetDistance(sw: StructuredWorkout): number {
  if (!sw.main_set) return 0

  const mainSet = Array.isArray(sw.main_set)
    ? (sw.main_set as MainSetGroup[])
    : [sw.main_set as MainSetGroup]

  let total = 0
  for (const group of mainSet) {
    const repeats = group.repeat ?? 1
    if (group.intervals) {
      for (const interval of group.intervals) {
        total += repeats * (interval.distance_meters ?? 0)
      }
    } else if (group.distance_meters) {
      total += repeats * group.distance_meters
    }
  }
  return total
}

/**
 * Rebuild structured_workout when workout type changes.
 * Generates a fresh structure appropriate for the new type.
 */
export function rebuildStructuredWorkoutForType(
  newType: string,
  distanceMeters: number | null,
  intensity: string
): StructuredWorkout {
  return buildStructuredWorkout({
    type: newType,
    distance_meters: distanceMeters,
    intensity,
  })
}

/**
 * Update intensity labels on all main_set intervals.
 * Returns a new object (does not mutate the input).
 */
export function updateStructuredWorkoutIntensity(
  sw: StructuredWorkout,
  newIntensity: string
): StructuredWorkout {
  if (!sw.main_set) return sw

  const result = { ...sw }
  const mainSet = Array.isArray(result.main_set)
    ? (result.main_set as MainSetGroup[])
    : [result.main_set as MainSetGroup]

  result.main_set = mainSet.map(group => {
    const g = { ...group }
    if (g.intensity) {
      g.intensity = newIntensity
    }
    if (g.intervals) {
      g.intervals = g.intervals.map(interval => {
        const i = { ...interval }
        // Only update non-recovery intervals — recovery stays as-is
        if (i.intensity && !i.intensity.toLowerCase().includes('recovery') && !i.intensity.toLowerCase().includes('rest')) {
          i.intensity = newIntensity
        }
        return i
      })
    }
    return g
  })

  return result
}
