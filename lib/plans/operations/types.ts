/**
 * Plan Operation Type Definitions
 *
 * Discrete operations that modify a training plan. The LLM outputs these
 * (~200 tokens) instead of regenerating complete weeks (~20k tokens).
 */

/**
 * Schedule change operations - move workouts between days
 */
export type ScheduleOperation =
  | {
      op: 'swap_days'
      weekNumbers: number[] | 'all'
      dayA: number
      dayB: number
    }
  | {
      op: 'move_workout_type'
      workoutType: string
      toDay: number
      weekNumbers: number[] | 'all'
    }
  | {
      op: 'reschedule_workout'
      workoutIndex?: string  // e.g., "W14:D6" - resolved to ID
      workoutId?: number     // Direct ID (optional if index provided)
      newDate: string
    }

/**
 * Workout modification operations - change individual workout properties
 * Note: workoutIndex (e.g., "W14:D6") will be resolved to workoutId before execution
 */
export type WorkoutModification =
  | {
      op: 'change_workout_type'
      workoutIndex?: string  // e.g., "W14:D6" - resolved to ID
      workoutId?: number     // Direct ID (optional if index provided)
      newType: string
      newDescription?: string
    }
  | {
      op: 'change_workout_distance'
      workoutIndex?: string
      workoutId?: number
      newDistanceMeters: number
    }
  | {
      op: 'scale_workout_distance'
      workoutIndex?: string
      workoutId?: number
      factor: number
    }
  | {
      op: 'change_intensity'
      workoutIndex?: string
      workoutId?: number
      newIntensity: string
    }

/**
 * Bulk operations - affect multiple workouts
 */
export type BulkOperation =
  | {
      op: 'remove_workout_type'
      workoutType: string
      replacement: string
      weekNumbers: number[] | 'all'
    }
  | {
      op: 'scale_week_volume'
      weekNumber: number
      factor: number
    }
  | {
      op: 'scale_phase_volume'
      phaseName: string
      factor: number
    }

/**
 * All operation types
 */
export type PlanOperation = ScheduleOperation | WorkoutModification | BulkOperation

/**
 * LLM response that requests fallback to full regeneration
 */
export interface FallbackRequest {
  fallback: true
  reason: string
}

/**
 * Result of operation validation
 */
export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * Preview of a single operation
 */
export interface OperationPreview {
  operation: PlanOperation
  description: string
  affectedWorkouts: Array<{
    workoutId: number
    weekNumber: number
    day: number
    before: {
      date: string
      type: string
      description: string
      distanceKm: number | null
    }
    after: {
      date: string
      type: string
      description: string
      distanceKm: number | null
    }
  }>
}

/**
 * Result of applying operations
 */
export interface ApplyResult {
  success: boolean
  operationsApplied: number
  workoutsModified: number
  errors: string[]
}

/**
 * Check if a response from LLM is a fallback request
 */
export function isFallbackRequest(response: any): response is FallbackRequest {
  return response && response.fallback === true && typeof response.reason === 'string'
}
