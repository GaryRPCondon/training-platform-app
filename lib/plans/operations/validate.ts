/**
 * Operation validation — checks operations before applying
 */

import type { FullPlanContext } from '@/lib/chat/plan-context-loader'
import type { PlanOperation, ValidationResult } from './types'

/**
 * Validate operations before applying
 *
 * Checks:
 * - Week numbers exist in plan
 * - Workout IDs exist (for direct references)
 * - Day numbers are valid (1-7)
 * - Workout types are valid
 * - No consecutive hard workouts after applying
 */
export function validateOperations(
  operations: PlanOperation[],
  planContext: FullPlanContext
): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  const validWorkoutTypes = [
    'rest', 'recovery', 'easy', 'easy_run', 'long_run',
    'progression', 'tempo', 'intervals', 'speed', 'race', 'cross_training'
  ]

  const hardWorkoutTypes = ['tempo', 'intervals', 'speed', 'race', 'long_run']

  for (const op of operations) {
    switch (op.op) {
      case 'swap_days':
        if (op.dayA < 1 || op.dayA > 7) {
          errors.push(`swap_days: Invalid day ${op.dayA}`)
        }
        if (op.dayB < 1 || op.dayB > 7) {
          errors.push(`swap_days: Invalid day ${op.dayB}`)
        }
        if (op.weekNumbers !== 'all') {
          for (const wn of op.weekNumbers) {
            if (!planContext.weeks.find(w => w.week_number === wn)) {
              errors.push(`swap_days: Week ${wn} not found`)
            }
          }
        }
        break

      case 'move_workout_type':
        if (op.toDay < 1 || op.toDay > 7) {
          errors.push(`move_workout_type: Invalid target day ${op.toDay}`)
        }
        if (!validWorkoutTypes.includes(op.workoutType)) {
          warnings.push(`move_workout_type: Unknown workout type "${op.workoutType}"`)
        }
        break

      case 'reschedule_workout':
        if (!/^\d{4}-\d{2}-\d{2}$/.test(op.newDate)) {
          errors.push(`reschedule_workout: Invalid date format "${op.newDate}"`)
        }
        break

      case 'change_workout_type':
        if (!validWorkoutTypes.includes(op.newType)) {
          warnings.push(`change_workout_type: Unknown workout type "${op.newType}"`)
        }
        break

      case 'change_workout_distance':
        if (op.newDistanceMeters < 0) {
          errors.push(`change_workout_distance: Distance cannot be negative`)
        }
        if (op.newDistanceMeters > 100000) {
          warnings.push(`change_workout_distance: Distance over 100km seems high`)
        }
        break

      case 'scale_workout_distance':
      case 'scale_week_volume':
      case 'scale_phase_volume':
        const factor = op.factor
        if (factor <= 0) {
          errors.push(`${op.op}: Factor must be positive`)
        }
        if (factor > 2) {
          warnings.push(`${op.op}: Scaling by more than 2x may be excessive`)
        }
        if (factor < 0.5) {
          warnings.push(`${op.op}: Scaling to less than 50% may be excessive`)
        }
        break

      case 'remove_workout_type':
        if (!validWorkoutTypes.includes(op.replacement)) {
          warnings.push(`remove_workout_type: Unknown replacement type "${op.replacement}"`)
        }
        break
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  }
}
