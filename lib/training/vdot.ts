/**
 * VDOT calculations based on Jack Daniels' Running Formula
 *
 * References:
 * - Daniels, J. (2013). Daniels' Running Formula (3rd ed.)
 * - VDOT = VO2max adjusted for running economy
 */

import { formatPace as formatPaceWithUnits, formatHms } from '@/lib/utils/units'

// ============================================================================
// VDOT Calculation from Race Performance
// ============================================================================

/**
 * Calculate VDOT from race time and distance
 *
 * @param raceTimeSeconds - Race finish time in seconds
 * @param raceDistanceMeters - Race distance in meters
 * @returns VDOT value (typically 30-85 for recreational to elite)
 */
export function calculateVDOT(
  raceTimeSeconds: number,
  raceDistanceMeters: number
): number {
  // Oxygen cost per meter
  const velocityMetersPerMinute = (raceDistanceMeters / raceTimeSeconds) * 60

  // VO2 cost formula (Daniels)
  const percentMax = 0.8 + 0.1894393 * Math.exp(-0.012778 * (raceTimeSeconds / 60)) +
                     0.2989558 * Math.exp(-0.1932605 * (raceTimeSeconds / 60))

  const vo2 = -4.60 + 0.182258 * velocityMetersPerMinute +
              0.000104 * velocityMetersPerMinute * velocityMetersPerMinute

  const vdot = vo2 / percentMax

  return Math.round(vdot * 10) / 10 // Round to 1 decimal
}

/**
 * Calculate VDOT from race time (MM:SS or HH:MM:SS format)
 */
export function calculateVDOTFromRaceTime(
  raceTime: string,
  raceDistance: RaceDistance
): number {
  const seconds = parseRaceTime(raceTime)
  const meters = RACE_DISTANCES[raceDistance]
  return calculateVDOT(seconds, meters)
}

// ============================================================================
// Training Pace Calculations
// ============================================================================

/**
 * Calculate training paces from VDOT
 * Returns paces in seconds per kilometer
 */
export interface TrainingPaces {
  easy: number          // Easy pace — the standard aerobic run (seconds/km)
  // Recovery pace (seconds/km) — deliberately slower than easy. Easy is the everyday
  // aerobic run; recovery is what you jog between reps, or the run whose only job is to
  // speed recovery from the muscular and physiological damage of a hard session. They
  // used to share one number, which meant "make this a recovery run" changed nothing.
  recovery: number
  marathon: number      // Marathon race pace (seconds/km)
  tempo: number         // Threshold/tempo pace (seconds/km)
  interval: number      // VO2max/5K pace (seconds/km)
  repetition: number    // Speed/3K pace (seconds/km)
  walk: number          // Brisk walking pace (seconds/km) — fitness-independent constant
}

// Brisk walking pace (~10 min/km, 6 km/h). Fitness-independent; templates that use
// `walk` as a reference_pace set prescription:'time' so the numeric value is informational.
export const WALK_PACE_SEC_PER_KM = 600

export function calculateTrainingPaces(vdot: number): TrainingPaces {
  // Formulas based on Jack Daniels' VDOT tables

  // Easy pace: ~65% of VDOT (conversational)
  const easyPace = calculatePaceForIntensity(vdot, 0.65)

  // Recovery pace: 59% of VDOT — the bottom of Daniels' Easy range (59-74% VO2max),
  // where easy sits mid-range at 65%. Deriving it from the same formula rather than
  // as a fixed offset keeps the gap proportional to fitness (~+25 s/km at VDOT 55,
  // ~+31 s/km at VDOT 40) instead of penalising faster runners.
  const recoveryPace = calculatePaceForIntensity(vdot, 0.59)

  // Marathon pace: 82% of VDOT
  // percentMax for a ~3h race converges to 0.818, so this is equivalent
  // to the exact marathon race pace without requiring iterative solving
  const marathonPace = calculatePaceForIntensity(vdot, 0.82)

  // Tempo/Threshold pace: 88% of VDOT (lactate threshold)
  const tempoPace = calculatePaceForIntensity(vdot, 0.88)

  // Interval pace: 98% of VDOT (VO2max, 3-5 min reps)
  const intervalPace = calculatePaceForIntensity(vdot, 0.98)

  // Repetition pace: 106% of VDOT (speed, < 2 min reps)
  const repetitionPace = calculatePaceForIntensity(vdot, 1.06)

  return {
    easy: Math.round(easyPace),
    recovery: Math.round(recoveryPace),
    marathon: Math.round(marathonPace),
    tempo: Math.round(tempoPace),
    interval: Math.round(intervalPace),
    repetition: Math.round(repetitionPace),
    walk: WALK_PACE_SEC_PER_KM,
  }
}

/**
 * Calculate pace (sec/km) for a given intensity percentage of VDOT
 */
function calculatePaceForIntensity(vdot: number, intensityPct: number): number {
  // Velocity at given intensity
  const vo2 = vdot * intensityPct

  // Solve for velocity in meters/minute from VO2
  // vo2 = -4.60 + 0.182258*v + 0.000104*v^2
  // Quadratic formula: a*v^2 + b*v + c = 0
  const a = 0.000104
  const b = 0.182258
  const c = -4.60 - vo2

  const velocityMetersPerMinute = (-b + Math.sqrt(b*b - 4*a*c)) / (2*a)

  // Convert to seconds per kilometer
  const secondsPerKm = (1000 / velocityMetersPerMinute) * 60

  return secondsPerKm
}

// ============================================================================
// Equivalent Race Times
// ============================================================================

/**
 * Calculate equivalent race times at different distances
 * Based on current VDOT
 */
export interface EquivalentTimes {
  'mile': number         // seconds
  '3k': number
  '5k': number
  '10k': number
  '15k': number
  '10_mile': number
  'half_marathon': number
  'marathon': number
}

export function calculateEquivalentTimes(vdot: number): EquivalentTimes {
  return {
    'mile': calculateRaceTime(vdot, RACE_DISTANCES['mile']),
    '3k': calculateRaceTime(vdot, RACE_DISTANCES['3k']),
    '5k': calculateRaceTime(vdot, RACE_DISTANCES['5k']),
    '10k': calculateRaceTime(vdot, RACE_DISTANCES['10k']),
    '15k': calculateRaceTime(vdot, RACE_DISTANCES['15k']),
    '10_mile': calculateRaceTime(vdot, RACE_DISTANCES['10_mile']),
    'half_marathon': calculateRaceTime(vdot, RACE_DISTANCES['half_marathon']),
    'marathon': calculateRaceTime(vdot, RACE_DISTANCES['marathon'])
  }
}

/**
 * Calculate predicted race time for a given distance at current VDOT.
 *
 * Uses bisection search for robustness across all distances (mile through marathon).
 * calculateVDOT is monotonically decreasing with time for a fixed distance:
 * shorter time → faster velocity → higher VDOT.
 */
function calculateRaceTime(vdot: number, distanceMeters: number): number {
  // Bracket: world record pace (~6 m/s) to very slow (1 m/s)
  let lo = distanceMeters / 6    // fastest plausible time
  let hi = distanceMeters / 1    // slowest plausible time

  // Bisection: find time where calculateVDOT(time, distance) ≈ target vdot
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2
    const midVDOT = calculateVDOT(mid, distanceMeters)

    if (Math.abs(midVDOT - vdot) < 0.01) {
      return Math.round(mid)
    }

    // Higher VDOT means faster (shorter time), so if midVDOT > target, we need more time
    if (midVDOT > vdot) {
      lo = mid
    } else {
      hi = mid
    }
  }

  return Math.round((lo + hi) / 2)
}

// ============================================================================
// Helper Types & Constants
// ============================================================================

export type RaceDistance = 'mile' | '3k' | '5k' | '10k' | '15k' | '10_mile' | 'half_marathon' | 'marathon'

export const RACE_DISTANCES: Record<RaceDistance, number> = {
  'mile': 1609.34,
  '3k': 3000,
  '5k': 5000,
  '10k': 10000,
  '15k': 15000,
  '10_mile': 16093.4,
  'half_marathon': 21097.5,
  'marathon': 42195
}

export const RACE_DISTANCE_LABELS: Record<RaceDistance, string> = {
  'mile': 'Mile',
  '3k': '3K',
  '5k': '5K',
  '10k': '10K',
  '15k': '15K',
  '10_mile': '10 Mile',
  'half_marathon': 'Half Marathon',
  'marathon': 'Marathon'
}

// ============================================================================
// Race Paces (sec/km at race effort for each distance)
// ============================================================================

/**
 * Race equivalent paces in seconds per km.
 * Used by methodology-specific pace targets (e.g. Pfitzinger LT = 15K-HM pace,
 * Magness 3K/5K/10K efforts). Stored in athletes.training_paces JSONB.
 */
export interface RacePaces {
  race_mile: number       // sec/km at mile race effort
  race_3k: number         // sec/km at 3K race effort
  race_5k: number         // sec/km at 5K race effort
  race_10k: number        // sec/km at 10K race effort
  race_15k: number        // sec/km at 15K race effort
  race_half_marathon: number // sec/km at half marathon race effort
}

/**
 * Calculate race-equivalent paces from VDOT.
 * Returns pace in seconds/km for each race distance.
 */
export function calculateRacePaces(vdot: number): RacePaces {
  const distances: { key: keyof RacePaces; distance: RaceDistance }[] = [
    { key: 'race_mile', distance: 'mile' },
    { key: 'race_3k', distance: '3k' },
    { key: 'race_5k', distance: '5k' },
    { key: 'race_10k', distance: '10k' },
    { key: 'race_15k', distance: '15k' },
    { key: 'race_half_marathon', distance: 'half_marathon' },
  ]

  const result = {} as RacePaces
  for (const { key, distance } of distances) {
    const timeSeconds = calculateRaceTime(vdot, RACE_DISTANCES[distance])
    const distanceKm = RACE_DISTANCES[distance] / 1000
    result[key] = Math.round(timeSeconds / distanceKm)
  }
  return result
}

/**
 * Combined training + race paces. This is what gets stored in athletes.training_paces.
 */
export type AllTrainingPaces = TrainingPaces & Partial<RacePaces>

/**
 * Parse race time string to seconds
 * Supports: "MM:SS" or "HH:MM:SS"
 */
export function parseRaceTime(timeString: string): number {
  const parts = timeString.split(':').map(Number)

  if (parts.length === 2) {
    // MM:SS
    const [minutes, seconds] = parts
    return minutes * 60 + seconds
  } else if (parts.length === 3) {
    // HH:MM:SS
    const [hours, minutes, seconds] = parts
    return hours * 3600 + minutes * 60 + seconds
  }

  throw new Error('Invalid time format. Use MM:SS or HH:MM:SS')
}

/**
 * Format seconds to pace string (MM:SS/km or MM:SS/mi)
 */
export function formatPace(secondsPerKm: number, units: 'metric' | 'imperial' = 'metric'): string {
  return formatPaceWithUnits(secondsPerKm, units)
}

/**
 * Format seconds to time string (HH:MM:SS or MM:SS)
 */
export function formatTime(totalSeconds: number): string {
  return formatHms(totalSeconds)
}

/**
 * Calculate estimated duration for distance at given pace
 */
export function estimateDuration(
  distanceMeters: number,
  paceSecondsPerKm: number
): number {
  return Math.round((distanceMeters / 1000) * paceSecondsPerKm)
}

/**
 * Map workout type to pace type
 * This is the primary method for determining pace from workout data
 */
export function getWorkoutPaceType(workoutType: string): keyof TrainingPaces {
  const typeLower = workoutType.toLowerCase()

  // Exact matches for workout types
  if (typeLower === 'intervals') return 'interval'
  if (typeLower === 'tempo') return 'tempo'
  if (typeLower === 'recovery') return 'recovery'
  if (typeLower === 'easy_run') return 'easy'
  if (typeLower === 'long_run') return 'easy'
  // 'race' falls through to marathon as a last-resort default. Consumers that
  // surface pace to the athlete (ICS export, Garmin mapper) short-circuit before
  // reaching this fallback so race day shows no pace target — see ics-export.ts
  // and workout-mapper.ts. This mapping is preserved for any non-presentation caller.
  if (typeLower === 'race') return 'marathon'

  // Partial matches for variations
  if (typeLower.includes('interval') || typeLower.includes('speed')) return 'interval'
  if (typeLower.includes('tempo') || typeLower.includes('threshold')) return 'tempo'
  if (typeLower.includes('marathon') || typeLower.includes('race')) return 'marathon'
  if (typeLower.includes('repetition') || typeLower.includes('rep')) return 'repetition'
  if (typeLower.includes('recovery')) return 'recovery'
  if (typeLower.includes('easy')) return 'easy'
  if (typeLower.includes('long')) return 'easy'

  // Default to easy for unknown types
  return 'easy'
}

// Default easy pace (6:00/km) used when no training paces are available
const DEFAULT_EASY_PACE_SEC_PER_KM = 360

/** A single structured_workout component (warmup, cooldown, or a main_set interval). */
export type StructuredPart = {
  role?: string
  intensity?: string
  target_pace?: string
  distance_meters?: number
  duration_seconds?: number
  duration_minutes?: number
}

/**
 * Roles that cover no ground: a standing rest between reps is time on the clock,
 * not distance. Sizing these at a running pace invents kilometres that were never
 * planned (a 4 × 60 s rest set added ~1.1 km to one long run before this rule).
 */
function isStandingRest(part: StructuredPart): boolean {
  return (part.role ?? '').toLowerCase() === 'rest' || (part.intensity ?? '').toLowerCase() === 'rest'
}

/** Seconds prescribed for a part, accepting either duration_seconds or duration_minutes. */
function partDurationSeconds(part: StructuredPart): number {
  if (part.duration_seconds) return part.duration_seconds
  if (part.duration_minutes) return part.duration_minutes * 60
  return 0
}

/**
 * Distance covered by one structured part. Distance-based parts are taken as-is;
 * time-based parts are converted at that part's OWN pace — its explicit target_pace
 * when present, otherwise the training pace for its intensity — so an easy float
 * inside a quality session is sized at E pace, not at the session's hardest pace.
 *
 * A part carrying neither target_pace nor intensity falls back to easy pace. That is
 * a deliberate change from the previous behaviour, which assumed interval pace for
 * anything not named "recovery": easy is the same fallback
 * {@link estimateWorkoutDurationSeconds} uses, and having the two functions agree
 * matters more than matching the old guess. Templates always set intensity, so this
 * only affects malformed structures.
 */
function structuredPartDistanceMeters(
  part: StructuredPart | undefined,
  trainingPaces: TrainingPaces | null | undefined,
  fallbackPaceSecPerKm: number
): number {
  if (!part) return 0
  if (part.distance_meters) return part.distance_meters
  if (isStandingRest(part)) return 0
  const seconds = partDurationSeconds(part)
  if (!seconds) return 0
  // A malformed target_pace ("0:00") parses to 0 and would make this Infinity, which
  // Math.round preserves all the way into distance_target_meters.
  const pace = resolvePartPaceSecPerKm(part, trainingPaces, fallbackPaceSecPerKm)
  if (pace <= 0) return 0
  return (seconds / pace) * 1000
}

/** Every structured part of a workout: warmup, each main_set interval, cooldown. */
function allStructuredParts(structuredWorkout: Record<string, unknown> | null | undefined): StructuredPart[] {
  const mainSet = structuredWorkout?.main_set
  if (!structuredWorkout || !Array.isArray(mainSet)) return []
  const parts: StructuredPart[] = []
  const warmup = structuredWorkout.warmup as StructuredPart | undefined
  if (warmup) parts.push(warmup)
  for (const group of mainSet as Array<{ intervals?: StructuredPart[] }>) {
    for (const interval of group.intervals ?? []) parts.push(interval)
  }
  const cooldown = structuredWorkout.cooldown as StructuredPart | undefined
  if (cooldown) parts.push(cooldown)
  return parts
}

/**
 * True when a workout prescribes only time — every part carries a duration and none
 * carries a distance (e.g. Daniels' "steady E run of 90-120 min"). Such a workout has
 * no distance target of its own: any distance is an estimate derived from pace, so it
 * must be scored on the clock rather than on that estimate.
 */
export function isTimePrescribedWorkout(structuredWorkout: Record<string, unknown> | null | undefined): boolean {
  const parts = allStructuredParts(structuredWorkout)
  if (parts.length === 0) return false
  return parts.every(p => !p.distance_meters && partDurationSeconds(p) > 0)
}

/** Total prescribed clock time across every structured part, honouring repeat counts. */
export function totalPrescribedSeconds(structuredWorkout: Record<string, unknown> | null | undefined): number {
  const mainSet = structuredWorkout?.main_set
  if (!structuredWorkout || !Array.isArray(mainSet)) return 0
  let seconds = partDurationSeconds((structuredWorkout.warmup as StructuredPart | undefined) ?? {})
  for (const group of mainSet as Array<{ repeat?: number; intervals?: StructuredPart[] }>) {
    const repeats = group.repeat ?? 1
    for (const interval of group.intervals ?? []) seconds += repeats * partDurationSeconds(interval)
  }
  seconds += partDurationSeconds((structuredWorkout.cooldown as StructuredPart | undefined) ?? {})
  return Math.round(seconds)
}

/**
 * Calculate total workout distance including warmup, cooldown, and all main_set intervals.
 *
 * When a structured_workout with a main_set array is present, distance is always derived
 * from the structured parts (warmup + all intervals × repeats + cooldown). This is the
 * single source of truth shared by the workout card view, edit mode, and proposal card.
 *
 * Each part is sized at its own pace via {@link structuredPartDistanceMeters}, matching
 * {@link estimateWorkoutDurationSeconds} — the two must agree, or a card can show a
 * distance and a duration that imply a pace the workout never prescribed.
 *
 * Fallback: returns distanceTargetMeters as-is for non-structured workouts.
 *
 * @param distanceTargetMeters - The workout's distance_target_meters field (fallback only)
 * @param workoutType - Unused; kept for API compatibility
 * @param structuredWorkout - The structured_workout JSONB from the database
 * @param trainingPaces - Optional training paces (uses 6:00/km easy pace fallback)
 * @returns Total estimated distance in meters
 */
export function calculateTotalWorkoutDistance(
  distanceTargetMeters: number | null | undefined,
  workoutType: string | null | undefined,
  structuredWorkout: Record<string, unknown> | null | undefined,
  trainingPaces?: TrainingPaces | null
): number {
  const mainSet = structuredWorkout?.main_set

  // Only compute from parts when there is a structured main_set to sum
  if (structuredWorkout && Array.isArray(mainSet)) {
    const easyPace = trainingPaces?.easy ?? DEFAULT_EASY_PACE_SEC_PER_KM

    const warmupMeters = structuredPartDistanceMeters(
      structuredWorkout.warmup as StructuredPart | undefined, trainingPaces, easyPace
    )
    const cooldownMeters = structuredPartDistanceMeters(
      structuredWorkout.cooldown as StructuredPart | undefined, trainingPaces, easyPace
    )

    let mainSetMeters = 0
    for (const group of mainSet as Array<{ repeat?: number; intervals?: StructuredPart[] }>) {
      const repeats = group.repeat ?? 1
      for (const interval of group.intervals ?? []) {
        mainSetMeters += repeats * structuredPartDistanceMeters(interval, trainingPaces, easyPace)
      }
    }

    const total = Math.round(warmupMeters + mainSetMeters + cooldownMeters)
    return total > 0 ? total : (distanceTargetMeters ?? 0)
  }

  return distanceTargetMeters ?? 0
}

/** Parse one "M:SS" clock token (optionally with a "/km" suffix) into seconds. */
function parseClockPart(token: string): number | null {
  const parts = token.trim().split('/')[0].split(':')
  if (parts.length !== 2) return null
  const minutes = Number(parts[0])
  const seconds = Number(parts[1])
  if (!Number.isInteger(minutes) || !Number.isInteger(seconds)) return null
  return minutes * 60 + seconds
}

/**
 * Parse a stored target_pace string into a representative sec/km value.
 * Handles single "M:SS" and "M:SS-M:SS" ranges (returns the midpoint).
 */
function parseTargetPaceSecPerKm(raw: string): number | null {
  const clean = raw.trim()
  const dash = clean.indexOf('-', 1)
  if (dash > 0) {
    const a = parseClockPart(clean.slice(0, dash))
    const b = parseClockPart(clean.slice(dash + 1))
    if (a != null && b != null) return (a + b) / 2
    return a ?? b
  }
  return parseClockPart(clean)
}

/** Resolve the pace (sec/km) for a single structured part, preferring its explicit target_pace. */
function resolvePartPaceSecPerKm(
  part: { target_pace?: string; intensity?: string },
  trainingPaces: TrainingPaces | null | undefined,
  fallbackPaceSecPerKm: number
): number {
  if (typeof part.target_pace === 'string') {
    const parsed = parseTargetPaceSecPerKm(part.target_pace)
    if (parsed != null) return parsed
  }
  if (part.intensity && trainingPaces) {
    const pace = trainingPaces[resolveIntensityPaceKey(part.intensity)]
    if (pace) return pace
  }
  return fallbackPaceSecPerKm
}

/**
 * Estimate total workout duration (seconds) including warmup, cooldown, and all
 * main_set intervals. Each structured part is timed with its own pace — an
 * explicit target_pace when present, otherwise its intensity's training pace —
 * so a custom-pace interval isn't mis-timed with a workout-type guess.
 *
 * Fallback: for a simple (non-structured) workout, times distanceTargetMeters at
 * fallbackPaceSecPerKm. Returns 0 when no duration can be determined.
 */
export function estimateWorkoutDurationSeconds(
  distanceTargetMeters: number | null | undefined,
  structuredWorkout: Record<string, unknown> | null | undefined,
  trainingPaces: TrainingPaces | null | undefined,
  fallbackPaceSecPerKm?: number | null
): number {
  const fallback = fallbackPaceSecPerKm ?? trainingPaces?.easy ?? DEFAULT_EASY_PACE_SEC_PER_KM
  const mainSet = structuredWorkout?.main_set

  const partSeconds = (part: StructuredPart | undefined): number => {
    if (!part) return 0
    // A prescribed duration wins — including standing rests, which cost clock time
    // even though they cover no distance.
    const seconds = partDurationSeconds(part)
    if (seconds) return seconds
    if (part.distance_meters) {
      const pace = resolvePartPaceSecPerKm(part, trainingPaces, fallback)
      return (part.distance_meters / 1000) * pace
    }
    return 0
  }

  if (structuredWorkout && Array.isArray(mainSet)) {
    let seconds = partSeconds(structuredWorkout.warmup as StructuredPart | undefined)
    for (const group of mainSet as Array<{ repeat?: number; intervals?: StructuredPart[] }>) {
      const repeats = group.repeat ?? 1
      for (const interval of group.intervals ?? []) {
        seconds += repeats * partSeconds(interval)
      }
    }
    seconds += partSeconds(structuredWorkout.cooldown as StructuredPart | undefined)
    return Math.round(seconds)
  }

  if (distanceTargetMeters) return estimateDuration(distanceTargetMeters, fallback)
  return 0
}

/**
 * Map a free-text intensity label to the training pace it should be run at.
 *
 * This is THE resolver for the intensity axis — the UI card, the Garmin mapper, the
 * plan importer and the distance/duration math all route through it. Four near-copies
 * of this logic used to exist side by side and had drifted apart (one sent `hard` to
 * easy pace; all four collapsed `recovery` onto `easy`), so a recovery run came out
 * identical to an easy run. Add new vocabulary here, not at the call site.
 *
 * Note the ordering: `recovery` must be tested before `easy`, and `repetition`/`stride`
 * before the bare `rep` alias.
 *
 * Callers that need "no pace at all" — a standing rest, a walk step, race day — must
 * short-circuit before calling this; every recognised label resolves to some pace.
 *
 * Returns null for labels it doesn't recognise, so callers with a better fallback
 * (the Garmin mapper defers to the workout type) can use it instead of a blanket easy.
 */
export function matchIntensityPaceKey(intensity: string): keyof TrainingPaces | null {
  const l = intensity.toLowerCase()

  if (l.includes('recovery')) return 'recovery'
  if (l.includes('walk')) return 'walk'
  if (l.includes('easy') || l.includes('long')) return 'easy'
  if (l.includes('marathon') || l.includes('moderate') || l.includes('race')) return 'marathon'
  if (l.includes('tempo') || l.includes('threshold') || l === 'lt') return 'tempo'
  if (l.includes('interval') || l.includes('vo2') || l.includes('hard')) return 'interval'
  if (l.includes('repetition') || l.includes('stride') || l.includes('speed') || l === 'rep') {
    return 'repetition'
  }

  return null
}

/** {@link matchIntensityPaceKey} with easy as the default for unrecognised labels. */
export function resolveIntensityPaceKey(intensity: string): keyof TrainingPaces {
  return matchIntensityPaceKey(intensity) ?? 'easy'
}

/** Default half-width of a prescribed pace band, in sec/km. */
export const PACE_TOLERANCE_SEC_PER_KM = 15

/**
 * Recovery gets a wider band.
 *
 * A recovery run is prescribed by effort, not by hitting a number — the point is to
 * stay easy, and natural recovery pace wanders. A ±15 band (5:19–5:49 around a 5:34
 * recovery pace) has the watch nagging a run that is doing exactly what it should.
 * ±30 (5:04–6:04) leaves room to drift while still warning when the run creeps up
 * toward easy pace, which is the one fault a recovery run can actually commit.
 *
 * Deliberately scoped to recovery: quality work IS prescribed to a number, and
 * widening its band would stop the watch flagging reps that miss.
 */
export const RECOVERY_PACE_TOLERANCE_SEC_PER_KM = 30

/**
 * Half-width of the pace band for a given intensity label. Shared by the Garmin
 * mapper and the workout card so the band shown to the athlete is the band sent to
 * the watch — they drifted apart once already.
 */
export function paceToleranceFor(intensity: string | null | undefined): number {
  if (intensity && matchIntensityPaceKey(intensity) === 'recovery') {
    return RECOVERY_PACE_TOLERANCE_SEC_PER_KM
  }
  return PACE_TOLERANCE_SEC_PER_KM
}
