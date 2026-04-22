import type { ParsedWorkout, PreWeekWorkout } from './response-parser'

type WorkoutInput = {
  type: string
  distance_meters?: number | null
  duration_seconds?: number | null
  intensity: string
  pace_guidance?: string | null
  notes?: string | null
  structured_workout?: Record<string, unknown> | null
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
 * Normalise a raw main_set from the LLM into the canonical [{repeat, intervals:[...]}] format.
 * Some models emit flat step arrays [{distance_meters, intensity}, ...] instead of wrapping
 * each step in a repeat group. Wrapping here keeps all downstream consumers consistent.
 */
function normalizeMainSet(raw: unknown): MainSetGroup[] {
  if (!Array.isArray(raw)) return []
  return (raw as Record<string, unknown>[]).map(item => {
    if (Array.isArray(item.intervals)) return item as unknown as MainSetGroup
    // Flat step — wrap into a single-rep group
    const { repeat, ...step } = item
    return { repeat: typeof repeat === 'number' ? repeat : 1, intervals: [step] } as MainSetGroup
  })
}

function isEasySingleGroup(group: MainSetGroup): boolean {
  if ((group.repeat !== 1 && group.repeat !== undefined) || !Array.isArray(group.intervals) || group.intervals.length !== 1) return false
  const intensity = (group.intervals[0].intensity ?? '').toLowerCase()
  return intensity === 'easy' || intensity === 'recovery' || intensity === 'walk'
}

/**
 * When the LLM embeds a leading or trailing single-easy step inside main_set instead of
 * using warmup/cooldown fields, extract it so the server doesn't add a duplicate default.
 * Only extracts if: repeat=1, single easy/recovery/walk interval, at least 2 groups remain.
 */
function extractEdgeEasyGroups(
  rawMainSet: MainSetGroup[],
  hasProvidedWarmup: boolean,
  hasProvidedCooldown: boolean
): { warmup?: unknown; main_set: MainSetGroup[]; cooldown?: unknown } {
  let ms = [...rawMainSet]
  let extractedWarmup: unknown
  let extractedCooldown: unknown

  if (!hasProvidedWarmup && ms.length >= 2 && isEasySingleGroup(ms[0])) {
    extractedWarmup = normalizeWarmupCooldown(ms[0].intervals![0])
    ms = ms.slice(1)
  }
  if (!hasProvidedCooldown && ms.length >= 2 && isEasySingleGroup(ms[ms.length - 1])) {
    extractedCooldown = normalizeWarmupCooldown(ms[ms.length - 1].intervals![0])
    ms = ms.slice(0, -1)
  }

  return {
    ...(extractedWarmup  !== undefined ? { warmup:   extractedWarmup  } : {}),
    main_set: ms,
    ...(extractedCooldown !== undefined ? { cooldown: extractedCooldown } : {}),
  }
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
      const rawMainSet       = normalizeMainSet(workout.structured_workout?.main_set)
      const llmProvidedWarmup  = workout.structured_workout?.warmup   !== undefined
      const llmProvidedCooldown= workout.structured_workout?.cooldown !== undefined
      const llmWarmup   = llmProvidedWarmup   ? normalizeWarmupCooldown(workout.structured_workout?.warmup)   : undefined
      const llmCooldown = llmProvidedCooldown ? normalizeWarmupCooldown(workout.structured_workout?.cooldown) : undefined

      const { warmup: edgeWarmup, main_set, cooldown: edgeCooldown } =
        extractEdgeEasyGroups(rawMainSet, llmProvidedWarmup, llmProvidedCooldown)

      // Default warmup/cooldown only when LLM provided neither (explicit LLM omission is respected)
      const warmup   = llmWarmup   ?? edgeWarmup   ?? { duration_minutes: 15, intensity: 'easy' }
      const cooldown = llmCooldown ?? edgeCooldown ?? (llmProvidedWarmup ? undefined : { duration_minutes: 10, intensity: 'easy' })

      const result: Record<string, unknown> = { main_set, pace_guidance, notes }
      if (warmup)   result.warmup   = warmup
      if (cooldown) result.cooldown = cooldown
      return result
    }
    case 'tempo': {
      const intervalIntensity = workout.intensity === 'marathon' ? 'marathon' : 'tempo'

      // If LLM provided a structured_workout with main_set, use it (preserving warmup/cooldown)
      if (workout.structured_workout?.main_set) {
        const rawMainSet          = normalizeMainSet(workout.structured_workout.main_set)
        const llmProvidedWarmup   = workout.structured_workout.warmup   !== undefined
        const llmProvidedCooldown = workout.structured_workout.cooldown !== undefined
        const llmWarmup   = llmProvidedWarmup   ? normalizeWarmupCooldown(workout.structured_workout.warmup)   : undefined
        const llmCooldown = llmProvidedCooldown ? normalizeWarmupCooldown(workout.structured_workout.cooldown) : undefined

        const { warmup: edgeWarmup, main_set, cooldown: edgeCooldown } =
          extractEdgeEasyGroups(rawMainSet, llmProvidedWarmup, llmProvidedCooldown)

        const warmup   = llmWarmup   ?? edgeWarmup   ?? { duration_minutes: 10, intensity: 'easy' }
        const cooldown = llmCooldown ?? edgeCooldown ?? (llmProvidedWarmup ? undefined : { duration_minutes: 10, intensity: 'easy' })
        const result: Record<string, unknown> = { main_set, pace_guidance, notes }
        if (warmup)   result.warmup   = warmup
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
