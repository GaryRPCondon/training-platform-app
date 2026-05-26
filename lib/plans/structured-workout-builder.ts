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

const NON_RUNNING_TYPES = new Set(['rest', 'cross_training', 'race'])

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

const VALID_ROLES: readonly IntervalRole[] = ['work', 'recovery', 'rest', 'warmup', 'cooldown'] as const

/**
 * Enforce the `role` contract on a repeat group's intervals.
 *
 * Rules:
 *   - Multi-interval groups MUST declare role on every child (work/recovery/rest).
 *     Missing or invalid role throws — this is the loud failure surface that
 *     keeps LLM ambiguity from leaking downstream to Garmin and the AI summary.
 *   - Single-interval groups default to role:'work' when missing — there's no
 *     ambiguity to resolve, and treating it as work matches every running
 *     methodology's convention.
 */
function enforceRoleContract(
  group: MainSetGroup,
  groupIndex: number
): MainSetGroup {
  const intervals = group.intervals
  if (!Array.isArray(intervals) || intervals.length === 0) return group

  if (intervals.length === 1) {
    const only = intervals[0]
    const role = only.role ?? 'work'
    if (!VALID_ROLES.includes(role)) {
      throw new Error(
        `main_set[${groupIndex}].intervals[0].role="${role}" invalid (expected work|recovery|rest|warmup|cooldown)`
      )
    }
    return { ...group, intervals: [{ ...only, role }] }
  }

  const validated = intervals.map((iv, ivIdx) => {
    if (!iv.role) {
      throw new Error(
        `main_set[${groupIndex}].intervals[${ivIdx}] missing required "role" — multi-interval repeats must declare work/recovery/rest/warmup/cooldown on every child`
      )
    }
    if (!VALID_ROLES.includes(iv.role)) {
      throw new Error(
        `main_set[${groupIndex}].intervals[${ivIdx}].role="${iv.role}" invalid (expected work|recovery|rest|warmup|cooldown)`
      )
    }
    return iv
  })
  return { ...group, intervals: validated }
}

/**
 * Normalise a raw main_set from the LLM into the canonical [{repeat, intervals:[...]}] format.
 * Handles three LLM quirks:
 *   1. Flat step arrays [{distance_meters, intensity}, ...] → wrap each in a single-rep group.
 *   2. Nested repeat groups inside a parent's intervals[] → flatten into sibling groups.
 *   3. Well-formed groups are passed through.
 * Then enforces the role contract on every emitted group.
 */
function normalizeMainSet(raw: unknown): MainSetGroup[] {
  if (!Array.isArray(raw)) return []
  const collected: MainSetGroup[] = []
  for (const item of raw as Record<string, unknown>[]) {
    if (Array.isArray(item.intervals)) {
      collected.push(...flattenNestedGroup(item))
    } else {
      // Flat step — wrap into a single-rep group
      const { repeat, ...step } = item
      collected.push({ repeat: typeof repeat === 'number' ? repeat : 1, intervals: [step] } as MainSetGroup)
    }
  }
  return collected.map((group, idx) => enforceRoleContract(group, idx))
}

/**
 * Normalize the structured_workout the LLM emitted into the canonical shape
 * downstream consumers (workout card, distance calc, Garmin mapper) expect.
 *
 * Under the Option A contract the LLM owns structure end-to-end — this is a
 * pass-through with normalization, not a synthesis step. No type-based
 * defaults; no W/C synthesis. If the LLM didn't emit structured_workout for
 * a running workout, that's caught by structural assertions.
 */
export function buildStructuredWorkout(workout: WorkoutInput): Record<string, unknown> {
  const pace_guidance = workout.pace_guidance ?? null
  const notes = workout.notes ?? null

  if (NON_RUNNING_TYPES.has(workout.type)) {
    return { pace_guidance, notes }
  }

  const llmStructure = workout.structured_workout
  if (!llmStructure) {
    return { pace_guidance, notes }
  }

  const result: Record<string, unknown> = { pace_guidance, notes }
  if (llmStructure.warmup) result.warmup = normalizeWarmupCooldown(llmStructure.warmup)
  if (llmStructure.main_set) result.main_set = normalizeMainSet(llmStructure.main_set)
  if (llmStructure.cooldown) result.cooldown = normalizeWarmupCooldown(llmStructure.cooldown)
  return result
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

export type IntervalRole = 'work' | 'recovery' | 'rest' | 'warmup' | 'cooldown'

interface MainSetInterval {
  distance_meters?: number
  duration_minutes?: number
  duration_seconds?: number
  intensity?: string
  target_pace?: string
  role?: IntervalRole
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
        // Only update work intervals — recovery/rest segments keep their pacing intent.
        // Role is authoritative; fall back to substring check only for legacy data
        // that pre-dates the role contract.
        const isWork = i.role
          ? i.role === 'work'
          : i.intensity != null &&
            !i.intensity.toLowerCase().includes('recovery') &&
            !i.intensity.toLowerCase().includes('rest')
        if (isWork && i.intensity) {
          i.intensity = newIntensity
        }
        return i
      })
    }
    return g
  })

  return result
}
