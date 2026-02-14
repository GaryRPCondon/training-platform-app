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

  // Easy pace: 59-74% of VDOT (conversational, recovery)
  const easyPace = calculatePaceForIntensity(vdot, 0.65)

  // Marathon pace: 80-88% of VDOT
  const marathonPace = calculatePaceForIntensity(vdot, 0.84)

  // Tempo/Threshold pace: 83-88% of VDOT (comfortably hard)
  const tempoPace = calculatePaceForIntensity(vdot, 0.88)

  // Interval pace: 98-100% of VDOT (hard, 3-5 min reps)
  const intervalPace = calculatePaceForIntensity(vdot, 1.0)

  // Repetition pace: 105-120% of VDOT (very hard, < 2 min reps)
  const repetitionPace = calculatePaceForIntensity(vdot, 1.10)

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
  '5k': number          // seconds
  '10k': number
  '10_mile': number
  'half_marathon': number
  'marathon': number
}

export function calculateEquivalentTimes(vdot: number): EquivalentTimes {
  return {
    '5k': calculateRaceTime(vdot, RACE_DISTANCES['5k']),
    '10k': calculateRaceTime(vdot, RACE_DISTANCES['10k']),
    '10_mile': calculateRaceTime(vdot, RACE_DISTANCES['10_mile']),
    'half_marathon': calculateRaceTime(vdot, RACE_DISTANCES['half_marathon']),
    'marathon': calculateRaceTime(vdot, RACE_DISTANCES['marathon'])
  }
}

/**
 * Calculate predicted race time for a given distance at current VDOT
 */
function calculateRaceTime(vdot: number, distanceMeters: number): number {
  // Reverse the VDOT calculation to find time
  // This is an iterative approximation

  let timeSeconds = distanceMeters / (vdot * 0.18) // Initial guess

  // Newton's method iteration (3-5 iterations usually sufficient)
  for (let i = 0; i < 5; i++) {
    const calculatedVDOT = calculateVDOT(timeSeconds, distanceMeters)
    const error = calculatedVDOT - vdot

    if (Math.abs(error) < 0.01) break

    // Adjust time based on error
    const adjustment = error * (timeSeconds / 100)
    timeSeconds -= adjustment
  }

  return Math.round(timeSeconds)
}

// ============================================================================
// Helper Types & Constants
// ============================================================================

export type RaceDistance = '5k' | '10k' | '10_mile' | 'half_marathon' | 'marathon'

export const RACE_DISTANCES: Record<RaceDistance, number> = {
  '5k': 5000,
  '10k': 10000,
  '10_mile': 16093.4,
  'half_marathon': 21097.5,
  'marathon': 42195
}

export const RACE_DISTANCE_LABELS: Record<RaceDistance, string> = {
  '5k': '5K',
  '10k': '10K',
  '10_mile': '10 Mile',
  'half_marathon': 'Half Marathon',
  'marathon': 'Marathon'
}

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
