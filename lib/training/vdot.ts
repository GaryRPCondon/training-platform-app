/**
 * VDOT calculations based on Jack Daniels' Running Formula
 *
 * References:
 * - Daniels, J. (2013). Daniels' Running Formula (3rd ed.)
 * - VDOT = VO2max adjusted for running economy
 */

import { formatPace as formatPaceWithUnits } from '@/lib/utils/units'

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
  easy: number          // Easy/recovery pace (seconds/km)
  marathon: number      // Marathon race pace (seconds/km)
  tempo: number         // Threshold/tempo pace (seconds/km)
  interval: number      // VO2max/5K pace (seconds/km)
  repetition: number    // Speed/3K pace (seconds/km)
}

export function calculateTrainingPaces(vdot: number): TrainingPaces {
  // Formulas based on Jack Daniels' VDOT tables

  // Easy pace: ~65% of VDOT (conversational, recovery)
  const easyPace = calculatePaceForIntensity(vdot, 0.65)

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
    marathon: Math.round(marathonPace),
    tempo: Math.round(tempoPace),
    interval: Math.round(intervalPace),
    repetition: Math.round(repetitionPace)
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
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = Math.round(totalSeconds % 60)

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  } else {
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }
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
  if (typeLower === 'recovery') return 'easy'
  if (typeLower === 'easy_run') return 'easy'
  if (typeLower === 'long_run') return 'easy'
  if (typeLower === 'race') return 'marathon'

  // Partial matches for variations
  if (typeLower.includes('interval') || typeLower.includes('speed')) return 'interval'
  if (typeLower.includes('tempo') || typeLower.includes('threshold')) return 'tempo'
  if (typeLower.includes('marathon') || typeLower.includes('race')) return 'marathon'
  if (typeLower.includes('repetition') || typeLower.includes('rep')) return 'repetition'
  if (typeLower.includes('recovery')) return 'easy'
  if (typeLower.includes('easy')) return 'easy'
  if (typeLower.includes('long')) return 'easy'

  // Default to easy for unknown types
  return 'easy'
}

// Default easy pace (6:00/km) used when no training paces are available
const DEFAULT_EASY_PACE_SEC_PER_KM = 360

/**
 * Calculate total workout distance including warmup, cooldown, and all main_set intervals.
 *
 * When a structured_workout with a main_set array is present, distance is always derived
 * from the structured parts (warmup + all intervals × repeats + cooldown). This is the
 * single source of truth shared by the workout card view, edit mode, and proposal card.
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
    const intervalPace = trainingPaces?.interval ?? DEFAULT_EASY_PACE_SEC_PER_KM
    const metersPerMin = (1000 / easyPace) * 60

    const warmup = structuredWorkout.warmup as { duration_minutes?: number; distance_meters?: number } | undefined
    const cooldown = structuredWorkout.cooldown as { duration_minutes?: number; distance_meters?: number } | undefined
    const warmupMeters = warmup?.distance_meters ?? (warmup?.duration_minutes ?? 0) * metersPerMin
    const cooldownMeters = cooldown?.distance_meters ?? (cooldown?.duration_minutes ?? 0) * metersPerMin

    let mainSetMeters = 0
    for (const group of mainSet as Array<{
      repeat?: number
      intervals?: Array<{ distance_meters?: number; duration_seconds?: number; intensity?: string }>
    }>) {
      const repeats = group.repeat ?? 1
      for (const interval of group.intervals ?? []) {
        if (interval.distance_meters) {
          mainSetMeters += repeats * interval.distance_meters
        } else if (interval.duration_seconds) {
          // Time-based interval: estimate distance from pace (recovery uses easy, work uses interval)
          const isRecovery = (interval.intensity ?? '').toLowerCase().includes('recovery')
          const paceSecPerKm = isRecovery ? easyPace : intervalPace
          mainSetMeters += repeats * (interval.duration_seconds / paceSecPerKm) * 1000
        }
      }
    }

    const total = Math.round(warmupMeters + mainSetMeters + cooldownMeters)
    return total > 0 ? total : (distanceTargetMeters ?? 0)
  }

  return distanceTargetMeters ?? 0
}

/**
 * Map workout intensity to pace type (fallback method)
 * @deprecated Use getWorkoutPaceType instead
 */
export function getIntensityPaceType(intensity: string): keyof TrainingPaces {
  const intensityLower = intensity.toLowerCase()

  if (intensityLower.includes('easy') || intensityLower.includes('recovery')) {
    return 'easy'
  } else if (intensityLower.includes('marathon') || intensityLower === 'moderate') {
    return 'marathon'
  } else if (intensityLower.includes('tempo') || intensityLower.includes('threshold')) {
    return 'tempo'
  } else if (intensityLower.includes('interval') || intensityLower.includes('vo2max')) {
    return 'interval'
  } else if (intensityLower.includes('repetition') || intensityLower.includes('speed')) {
    return 'repetition'
  }

  // Default to easy for unknown intensities
  return 'easy'
}
