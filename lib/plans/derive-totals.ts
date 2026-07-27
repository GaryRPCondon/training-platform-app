import type { ParsedPlan } from './response-parser'
import { calculateTotalWorkoutDistance, isTimePrescribedWorkout, totalPrescribedSeconds } from '@/lib/training/vdot'
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
 *
 * Also stamps duration_seconds on purely time-prescribed workouts (e.g. Daniels'
 * "steady E run of 90-120 min", stored as a single 5400 s easy interval). Those
 * carry no distance of their own, so without a duration target the scoring path
 * judges them on a distance nobody prescribed — run the 90 minutes exactly as
 * asked on a slow day and you would still be marked short.
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

      // Time-prescribed sessions are scored on the clock, not on a derived distance.
      // Set-or-null, mirroring distance: the LLM is told to emit a top-level
      // duration_seconds for time-based templates, defined as the session total
      // "excluding warmup/cooldown" — which is NOT what duration_target_seconds is
      // compared against. determineCompletionStatus weighs it against the activity's
      // whole elapsed time, so the target must include warmup and cooldown. Deriving
      // it here from the full structure is the only definition that matches, and
      // nulling otherwise stops a stray LLM value surviving onto a distance workout.
      const seconds = isTimePrescribedWorkout(workout.structured_workout)
        ? totalPrescribedSeconds(workout.structured_workout)
        : 0
      workout.duration_seconds = seconds > 0 ? seconds : null
    }
    week.weekly_total_km = Math.round(weekMeters / 100) / 10
  }
}
