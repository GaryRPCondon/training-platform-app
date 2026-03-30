/**
 * Human-readable descriptions of plan operations
 */

import type { PlanOperation } from './types'
import { getDayName } from './helpers'

/**
 * Generate human-readable description of an operation
 *
 * @param op - Operation to describe
 * @param weekStartsOn - Day of week that week starts on (0=Sunday, 1=Monday, etc.) - defaults to 0 (Sunday)
 */
export function describeOperation(op: PlanOperation, weekStartsOn: number = 0): string {
  switch (op.op) {
    case 'swap_days': {
      const weekDesc = op.weekNumbers === 'all' ? 'all weeks' : `weeks ${(op.weekNumbers as number[]).join(', ')}`
      const dayAName = getDayName(op.dayA, weekStartsOn)
      const dayBName = getDayName(op.dayB, weekStartsOn)
      return `Swap ${dayAName} and ${dayBName} in ${weekDesc}`
    }
    case 'move_workout_type': {
      const weekDesc = op.weekNumbers === 'all' ? 'all weeks' : `weeks ${(op.weekNumbers as number[]).join(', ')}`
      const dayName = getDayName(op.toDay, weekStartsOn)
      return `Move ${op.workoutType} workouts to ${dayName} in ${weekDesc}`
    }
    case 'reschedule_workout':
      return `Move workout ${op.workoutIndex || `#${op.workoutId}`} to ${op.newDate}`
    case 'change_workout_type':
      return `Change workout ${op.workoutIndex || `#${op.workoutId}`} to ${op.newType}`
    case 'change_workout_distance':
      return `Change workout ${op.workoutIndex || `#${op.workoutId}`} distance to ${(op.newDistanceMeters / 1000).toFixed(1)}km`
    case 'scale_workout_distance':
      return `Scale workout ${op.workoutIndex || `#${op.workoutId}`} distance by ${(op.factor * 100).toFixed(0)}%`
    case 'change_intensity':
      return `Change workout ${op.workoutIndex || `#${op.workoutId}`} intensity to ${op.newIntensity}`
    case 'remove_workout_type': {
      const weekDesc = op.weekNumbers === 'all' ? 'all weeks' : `weeks ${(op.weekNumbers as number[]).join(', ')}`
      return `Replace ${op.workoutType} with ${op.replacement} in ${weekDesc}`
    }
    case 'scale_week_volume':
      return `Scale week ${op.weekNumber} volume by ${(op.factor * 100).toFixed(0)}%`
    case 'scale_phase_volume':
      return `Scale ${op.phaseName} phase volume by ${(op.factor * 100).toFixed(0)}%`
    default:
      return `Unknown operation`
  }
}
