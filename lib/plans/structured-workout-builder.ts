import type { ParsedWorkout, PreWeekWorkout } from './response-parser'

type WorkoutInput = {
  type: string
  distance_meters?: number | null
  duration_seconds?: number | null
  intensity: string
  pace_guidance?: string | null
  notes?: string | null
  structured_workout?: Record<string, unknown> | null
  is_session?: boolean
  warmup_cooldown?: 'included' | 'add'
}

/**
 * Normalise a warmup/cooldown step so it always uses duration_minutes.
 * Some models emit duration_seconds on warmup/cooldown steps; all downstream
 * consumers (distance calc, Garmin mapper) expect duration_minutes.
 */
function normalizeWarmupCooldown(step: unknown): unknown {
  if (!step || typeof step !== 'object') return step
  const s = { ...(step as Record<string, unknown>) }
  if (typeof s.duration_seconds === 'number' && s.duration_minutes === undefined) {
    s.duration_minutes = Math.round(s.duration_seconds / 60)
    delete s.duration_seconds
  }
  return s
}

/**
 * Flatten a main_set group whose intervals[] contains nested repeat groups.
 * When the LLM emits `{repeat:1, intervals:[stepA, {repeat:2, intervals:[...]}, stepC]}`
 * the nested repeat group breaks the renderer, Garmin mapper, and edge-easy extractor
 * (all assume each element of intervals[] is a leaf step).
 *
 * Only flatten when the parent `repeat === 1` — flattening a nested group inside
 * e.g. `repeat:3` would change the meaning (nested would execute 3× in context).
 * For parent repeat > 1, leave as-is (validator will warn).
 */
function flattenNestedGroup(group: Record<string, unknown>): MainSetGroup[] {
  const parentRepeat = typeof group.repeat === 'number' ? group.repeat : 1
  const intervals = Array.isArray(group.intervals) ? group.intervals as Record<string, unknown>[] : []
  const hasNested = intervals.some(i => Array.isArray(i.intervals))

  if (!hasNested || parentRepeat !== 1) {
    return [group as unknown as MainSetGroup]
  }

  // Split the parent group by nested-repeat boundaries.
  const result: MainSetGroup[] = []
  let leafRun: Record<string, unknown>[] = []
  for (const item of intervals) {
    if (Array.isArray(item.intervals)) {
      if (leafRun.length > 0) {
        result.push({ repeat: 1, intervals: leafRun as MainSetInterval[] })
        leafRun = []
      }
      const nestedRepeat = typeof item.repeat === 'number' ? item.repeat : 1
      result.push({ repeat: nestedRepeat, intervals: item.intervals as MainSetInterval[] })
    } else {
      leafRun.push(item)
    }
  }
  if (leafRun.length > 0) result.push({ repeat: 1, intervals: leafRun as MainSetInterval[] })
  return result
}

/**
 * Normalise a raw main_set from the LLM into the canonical [{repeat, intervals:[...]}] format.
 * Handles three LLM quirks:
 *   1. Flat step arrays [{distance_meters, intensity}, ...] → wrap each in a single-rep group.
 *   2. Nested repeat groups inside a parent's intervals[] → flatten into sibling groups.
 *   3. Well-formed groups are passed through.
 */
function normalizeMainSet(raw: unknown): MainSetGroup[] {
  if (!Array.isArray(raw)) return []
  const out: MainSetGroup[] = []
  for (const item of raw as Record<string, unknown>[]) {
    if (Array.isArray(item.intervals)) {
      out.push(...flattenNestedGroup(item))
    } else {
      // Flat step — wrap into a single-rep group
      const { repeat, ...step } = item
      out.push({ repeat: typeof repeat === 'number' ? repeat : 1, intervals: [step] } as MainSetGroup)
    }
  }
  return out
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

  // Explicit session metadata from template — overrides type-based dispatch.
  // is_session=true with warmup_cooldown='included' means the description's leading/trailing
  // easy segments ARE the W/C; main_set covers the entire workout, no synthesised W/C.
  // is_session=false suppresses structured_workout regardless of type.
  if (workout.is_session === true) {
    const main_set = normalizeMainSet(workout.structured_workout?.main_set)
    if (workout.warmup_cooldown === 'included') {
      return { main_set, pace_guidance, notes }
    }
    // 'add' (or undefined) — synthesise W/C with type-appropriate defaults
    const defaultWarmupMinutes = workout.type === 'intervals' ? 15 : 10
    const warmup = workout.structured_workout?.warmup
      ? normalizeWarmupCooldown(workout.structured_workout.warmup)
      : { duration_minutes: defaultWarmupMinutes, intensity: 'easy' }
    const cooldown = workout.structured_workout?.cooldown
      ? normalizeWarmupCooldown(workout.structured_workout.cooldown)
      : { duration_minutes: 10, intensity: 'easy' }
    const result: Record<string, unknown> = { main_set, pace_guidance, notes }
    if (warmup) result.warmup = warmup
    if (cooldown) result.cooldown = cooldown
    return result
  }
  if (workout.is_session === false) {
    const llmStructure = workout.structured_workout
    if (llmStructure?.warmup !== undefined || llmStructure?.main_set !== undefined) {
      const result: Record<string, unknown> = { pace_guidance, notes }
      if (llmStructure.warmup) result.warmup = normalizeWarmupCooldown(llmStructure.warmup)
      if (llmStructure.main_set) result.main_set = normalizeMainSet(llmStructure.main_set)
      if (llmStructure.cooldown) result.cooldown = normalizeWarmupCooldown(llmStructure.cooldown)
      return result
    }
    return { pace_guidance, notes }
  }

  // Fallback: legacy type-based dispatch when is_session is not provided
  // (catalogs that haven't adopted the new metadata yet).
  switch (workout.type) {
    case 'intervals': {
      const main_set = normalizeMainSet(workout.structured_workout?.main_set)
      // If LLM provided warmup (time-based templates), use it instead of defaults
      const llmProvidedStructure = workout.structured_workout?.warmup !== undefined
      const warmup = llmProvidedStructure
        ? normalizeWarmupCooldown(workout.structured_workout?.warmup)
        : { duration_minutes: 15, intensity: 'easy' }
      const cooldown = llmProvidedStructure
        ? normalizeWarmupCooldown(workout.structured_workout?.cooldown)
        : { duration_minutes: 10, intensity: 'easy' }

      const result: Record<string, unknown> = { main_set, pace_guidance, notes }
      if (warmup) result.warmup = warmup
      if (cooldown) result.cooldown = cooldown
      return result
    }
    case 'tempo': {
      const intervalIntensity = workout.intensity === 'marathon' ? 'marathon' : 'tempo'

      // If LLM provided a structured_workout with main_set, use it (preserving warmup/cooldown)
      if (workout.structured_workout?.main_set) {
        const main_set = normalizeMainSet(workout.structured_workout.main_set)
        const warmup = normalizeWarmupCooldown(workout.structured_workout.warmup) ?? { duration_minutes: 10, intensity: 'easy' }
        const cooldown = normalizeWarmupCooldown(workout.structured_workout.cooldown) ?? { duration_minutes: 10, intensity: 'easy' }
        const result: Record<string, unknown> = { main_set, pace_guidance, notes }
        if (warmup) result.warmup = warmup
        if (cooldown) result.cooldown = cooldown
        return result
      }

      // LLM provided warmup/cooldown but forgot main_set (time-based tempo with framing steps)
      // Build main_set from duration_seconds and preserve the LLM's warmup/cooldown
      if (workout.structured_workout && !workout.structured_workout.main_set && workout.duration_seconds) {
        const warmup = normalizeWarmupCooldown(workout.structured_workout.warmup) ?? { duration_minutes: 10, intensity: 'easy' }
        const cooldown = normalizeWarmupCooldown(workout.structured_workout.cooldown) ?? { duration_minutes: 10, intensity: 'easy' }
        const result: Record<string, unknown> = {
          main_set: [{ repeat: 1, intervals: [{ duration_seconds: workout.duration_seconds, intensity: intervalIntensity }] }],
          pace_guidance,
          notes,
        }
        if (warmup) result.warmup = warmup
        if (cooldown) result.cooldown = cooldown
        return result
      }

      // Auto-generate structure: prefer distance_meters, fall back to duration_seconds
      const mainInterval: Record<string, unknown> = { intensity: intervalIntensity }
      if (workout.distance_meters) {
        mainInterval.distance_meters = workout.distance_meters
      } else if (workout.duration_seconds) {
        mainInterval.duration_seconds = workout.duration_seconds
      } else {
        mainInterval.distance_meters = 0
      }

      return {
        warmup: { duration_minutes: 10, intensity: 'easy' },
        main_set: [{ repeat: 1, intervals: [mainInterval] }],
        cooldown: { duration_minutes: 10, intensity: 'easy' },
        pace_guidance,
        notes,
      }
    }
    default: {
      // easy_run, recovery, long_run, rest, cross_training, race
      // If the LLM provided warmup/main_set (e.g. time-based continuous runs with warm-up walk),
      // preserve them so the workout gets proper structure on Garmin
      const llmStructure = workout.structured_workout
      if (llmStructure?.warmup !== undefined || llmStructure?.main_set !== undefined) {
        const result: Record<string, unknown> = { pace_guidance, notes }
        if (llmStructure.warmup) result.warmup = normalizeWarmupCooldown(llmStructure.warmup)
        if (llmStructure.main_set) result.main_set = normalizeMainSet(llmStructure.main_set)
        if (llmStructure.cooldown) result.cooldown = normalizeWarmupCooldown(llmStructure.cooldown)
        return result
      }
      return { pace_guidance, notes }
    }
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
