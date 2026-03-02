import type { ParsedPlan, ParsedWorkout } from './response-parser'

export interface WorkoutValidationWarning {
  workoutIndex: string
  weekNumber: number
  dayNumber: number
  description: string
  workoutType: string
  actualDistance: number
  expectedRange: { min: number; max: number }
  message: string
}

/**
 * Distance ranges by workout type (in meters)
 * Based on common training plan patterns
 */
const DISTANCE_RANGES: Record<string, { min: number; max: number }> = {
  intervals: { min: 3000, max: 25000 },      // 3-25km (work distance only, excl. recovery; early speed sessions can be short)
  tempo: { min: 5000, max: 35000 },          // 5-35km (work segment only; warmup/cooldown added server-side)
  easy_run: { min: 3000, max: 25000 },       // 3-25km (allows taper shakeout runs)
  long_run: { min: 10000, max: 50000 },      // 10-50km (early plan long runs can be ~10km)
  recovery: { min: 3000, max: 12000 },       // 3-12km
  cross_training: { min: 0, max: 0 },        // No distance validation
  rest: { min: 0, max: 0 },                  // No distance validation
  race: { min: 5000, max: 100000 }           // 5km to 100km
}

/**
 * Validate workout distances for potential LLM hallucinations
 * Returns warnings for workouts that fall outside expected ranges
 */
export function validateWorkoutDistances(parsedPlan: ParsedPlan): WorkoutValidationWarning[] {
  const warnings: WorkoutValidationWarning[] = []

  for (const week of parsedPlan.weeks) {
    for (const workout of week.workouts) {
      // Skip workouts without distance targets
      if (!workout.distance_meters || workout.distance_meters === 0) {
        continue
      }

      // Get expected range for this workout type
      const workoutType = workout.type.toLowerCase()
      const range = DISTANCE_RANGES[workoutType]

      // Skip if no range defined for this type (unknown workout types)
      if (!range) {
        continue
      }

      // Skip rest and cross-training (no distance validation needed)
      if (range.min === 0 && range.max === 0) {
        continue
      }

      // Check if distance is outside expected range
      const actualDistance = workout.distance_meters
      if (actualDistance < range.min || actualDistance > range.max) {
        warnings.push({
          workoutIndex: workout.workout_index,
          weekNumber: week.week_number,
          dayNumber: workout.day,
          description: workout.description || 'Untitled workout',
          workoutType: workout.type,
          actualDistance,
          expectedRange: range,
          message: `Possible LLM hallucination: ${workout.workout_index} "${workout.description}" has distance ${(actualDistance / 1000).toFixed(1)}km, but expected range for ${workout.type} is ${(range.min / 1000).toFixed(1)}-${(range.max / 1000).toFixed(1)}km`
        })
      }
    }
  }

  return warnings
}

/**
 * Format warnings for display to user
 */
export function formatValidationWarnings(warnings: WorkoutValidationWarning[]): string {
  if (warnings.length === 0) {
    return ''
  }

  const lines = [
    '⚠️  Potential LLM Hallucinations Detected:',
    '',
    ...warnings.map(w =>
      `• ${w.workoutIndex}: "${w.description}" - Distance is ${(w.actualDistance / 1000).toFixed(1)}km (expected ${(w.expectedRange.min / 1000).toFixed(1)}-${(w.expectedRange.max / 1000).toFixed(1)}km for ${w.workoutType})`
    ),
    '',
    'Consider regenerating the plan to get corrected distances.'
  ]

  return lines.join('\n')
}
