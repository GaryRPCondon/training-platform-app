import type { ParsedPlan } from './response-parser'
import { calculateTotalWorkoutDistance } from '@/lib/training/vdot'
import type { TrainingPaces } from '@/types/database'

const NON_RUNNING_TYPES = new Set(['rest', 'cross_training'])

/**
 * Derive distance_meters per workout and weekly_total_km per week from
 * each workout's structured_workout components, using the athlete's training
 * paces to convert time-based components on the fly.
 *
 * Mutates parsedPlan in place. Replaces any LLM-emitted values for these
 * fields — under the Option A contract the LLM no longer owns volume math.
 *
 * Race workouts retain their LLM-supplied distance (the goal race distance);
 * rest and cross_training are treated as zero-distance.
 */
export function deriveTotals(
  parsedPlan: ParsedPlan,
  trainingPaces?: TrainingPaces | null
): void {
  for (const week of parsedPlan.weeks) {
    let weekMeters = 0
    for (const workout of week.workouts) {
      if (NON_RUNNING_TYPES.has(workout.type)) {
        workout.distance_meters = null
        continue
      }

      const derived = calculateTotalWorkoutDistance(
        workout.distance_meters,
        workout.type,
        workout.structured_workout,
        trainingPaces
      )

      workout.distance_meters = derived > 0 ? derived : null
      weekMeters += derived
    }
    week.weekly_total_km = Math.round(weekMeters / 100) / 10
  }
}
