import type { ParsedPlan } from './response-parser'

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

const TOLERANCE = 0.10 // ±10%

/**
 * Validate workout distances for potential LLM hallucinations.
 * Uses template-specific validation ranges with ±10% tolerance.
 */
export function validateWorkoutDistances(
  parsedPlan: ParsedPlan,
  validationRanges: Record<string, { min: number; max: number }>
): WorkoutValidationWarning[] {
  const warnings: WorkoutValidationWarning[] = []

  for (const week of parsedPlan.weeks) {
    for (const workout of week.workouts) {
      if (!workout.distance_meters || workout.distance_meters === 0) {
        continue
      }

      const workoutType = workout.type.toLowerCase()
      const range = validationRanges[workoutType]

      if (!range) {
        continue
      }

      // Skip rest and cross-training (no distance validation needed)
      if (range.min === 0 && range.max === 0) {
        continue
      }

      const actualDistance = workout.distance_meters
      const effectiveMin = range.min * (1 - TOLERANCE)
      const effectiveMax = range.max * (1 + TOLERANCE)

      if (actualDistance < effectiveMin || actualDistance > effectiveMax) {
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
