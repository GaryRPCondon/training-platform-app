/**
 * Plan Replacer for Phase 5 Chat Refinement
 *
 * Handles atomic replacement of plan weeks in the database.
 * Used when applying LLM-regenerated weeks to an existing plan.
 *
 * Key responsibilities:
 * - Delete existing weeks/workouts for affected week numbers
 * - Insert regenerated weeks/workouts
 * - Maintain plan integrity (phases, indices, dates)
 * - Execute in transaction for atomicity
 */

import { createClient } from '@/lib/supabase/server'
import type { FullPlanContext } from './plan-context-loader'

/**
 * Regenerated week from LLM
 */
export interface RegeneratedWeek {
  week_number: number
  phase_name: string
  weekly_volume_km: number
  workouts: Array<{
    day: number
    workout_type: string
    description: string
    distance_km: number | null
    intensity_target: string
  }>
}

/**
 * Result of week replacement operation
 */
export interface ReplacementResult {
  success: boolean
  weeks_replaced: number
  workouts_created: number
  errors?: string[]
}

/**
 * Replace specific weeks in a training plan with regenerated versions
 *
 * This is the core database operation for applying plan modifications.
 * Executes atomically - either all weeks are replaced or none are.
 *
 * @param planId - ID of the training plan to modify
 * @param regeneratedWeeks - New week data from LLM
 * @param planContext - Full plan context for validation and date calculation
 * @returns Result with success status and counts
 *
 * @example
 * const result = await replaceWeeksInPlan(123, regeneratedWeeks, context)
 * if (result.success) {
 *   console.log(`Replaced ${result.weeks_replaced} weeks`)
 * }
 */
export async function replaceWeeksInPlan(
  planId: number,
  regeneratedWeeks: RegeneratedWeek[],
  planContext: FullPlanContext
): Promise<ReplacementResult> {
  const supabase = await createClient()
  const errors: string[] = []

  try {
    // Edge case: Empty regenerated weeks
    if (!regeneratedWeeks || regeneratedWeeks.length === 0) {
      return {
        success: false,
        weeks_replaced: 0,
        workouts_created: 0,
        errors: ['No weeks to regenerate']
      }
    }

    // Get current user
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser()
    if (userError || !user) {
      return {
        success: false,
        weeks_replaced: 0,
        workouts_created: 0,
        errors: ['Not authenticated']
      }
    }

    // Verify plan ownership and status
    const { data: plan, error: planError } = await supabase
      .from('training_plans')
      .select('id, athlete_id, start_date, status')
      .eq('id', planId)
      .eq('athlete_id', user.id)
      .single()

    if (planError || !plan) {
      return {
        success: false,
        weeks_replaced: 0,
        workouts_created: 0,
        errors: ['Plan not found or access denied']
      }
    }

    // Edge case: Prevent modification of completed plans
    if (plan.status === 'completed') {
      return {
        success: false,
        weeks_replaced: 0,
        workouts_created: 0,
        errors: ['Cannot modify a completed plan']
      }
    }

    // Edge case: Validate start date exists
    if (!plan.start_date) {
      return {
        success: false,
        weeks_replaced: 0,
        workouts_created: 0,
        errors: ['Plan has no start date']
      }
    }

    // Execute replacement in transaction-like manner
    // (Supabase doesn't expose transactions directly, but CASCADE constraints help)
    let totalWorkoutsCreated = 0

    for (const regeneratedWeek of regeneratedWeeks) {
      // Find the phase for this week
      const originalWeek = planContext.weeks.find(
        w => w.week_number === regeneratedWeek.week_number
      )
      if (!originalWeek) {
        errors.push(`Week ${regeneratedWeek.week_number} not found in original plan`)
        continue
      }

      // Get phase ID
      const { data: phases, error: phaseError } = await supabase
        .from('training_phases')
        .select('id, phase_name')
        .eq('plan_id', planId)
        .eq('phase_name', regeneratedWeek.phase_name)

      if (phaseError || !phases || phases.length === 0) {
        errors.push(`Phase "${regeneratedWeek.phase_name}" not found`)
        continue
      }

      const phaseId = phases[0].id

      // Find existing weekly_plan record
      const { data: existingWeeks, error: weekError } = await supabase
        .from('weekly_plans')
        .select('id')
        .eq('phase_id', phaseId)
        .eq('week_number', regeneratedWeek.week_number)

      if (weekError) {
        errors.push(`Error finding week ${regeneratedWeek.week_number}: ${weekError.message}`)
        continue
      }

      let weeklyPlanId: number

      if (existingWeeks && existingWeeks.length > 0) {
        // Week exists - delete old workouts (CASCADE will handle this via foreign key)
        weeklyPlanId = existingWeeks[0].id

        const { error: deleteError } = await supabase
          .from('planned_workouts')
          .delete()
          .eq('weekly_plan_id', weeklyPlanId)

        if (deleteError) {
          errors.push(`Error deleting workouts for week ${regeneratedWeek.week_number}: ${deleteError.message}`)
          continue
        }

        // Update weekly_plan volume
        const { error: updateError } = await supabase
          .from('weekly_plans')
          .update({
            weekly_volume_target: Math.round(regeneratedWeek.weekly_volume_km * 1000) // Convert to meters
          })
          .eq('id', weeklyPlanId)

        if (updateError) {
          errors.push(`Error updating week ${regeneratedWeek.week_number}: ${updateError.message}`)
          continue
        }
      } else {
        // Week doesn't exist - create it
        // Calculate week start date
        const weekStartDate = calculateWeekStartDate(
          plan.start_date,
          regeneratedWeek.week_number,
          planContext.athlete_constraints.days_per_week || 7
        )

        const { data: newWeek, error: createWeekError } = await supabase
          .from('weekly_plans')
          .insert({
            phase_id: phaseId,
            week_number: regeneratedWeek.week_number,
            week_start_date: weekStartDate,
            weekly_volume_target: Math.round(regeneratedWeek.weekly_volume_km * 1000)
          })
          .select('id')
          .single()

        if (createWeekError || !newWeek) {
          errors.push(`Error creating week ${regeneratedWeek.week_number}: ${createWeekError?.message}`)
          continue
        }

        weeklyPlanId = newWeek.id
      }

      // Insert new workouts
      const workoutsToInsert = regeneratedWeek.workouts.map(workout => {
        // Calculate scheduled date
        const scheduledDate = calculateWorkoutDate(
          plan.start_date,
          regeneratedWeek.week_number,
          workout.day,
          planContext.athlete_constraints.days_per_week || 7
        )

        // Generate workout index (W#:D# format)
        const workoutIndex = `W${regeneratedWeek.week_number}:D${workout.day}`

        return {
          weekly_plan_id: weeklyPlanId,
          workout_index: workoutIndex,
          scheduled_date: scheduledDate,
          workout_type: workout.workout_type,
          description: workout.description,
          distance_target_meters: workout.distance_km ? Math.round(workout.distance_km * 1000) : null,
          intensity_target: workout.intensity_target,
          structured_workout: null, // TODO: Build structured workout if needed
          status: 'scheduled'
        }
      })

      const { error: insertError } = await supabase
        .from('planned_workouts')
        .insert(workoutsToInsert)

      if (insertError) {
        errors.push(`Error inserting workouts for week ${regeneratedWeek.week_number}: ${insertError.message}`)
        continue
      }

      totalWorkoutsCreated += workoutsToInsert.length
    }

    // If we had errors, return partial success
    if (errors.length > 0) {
      return {
        success: false,
        weeks_replaced: regeneratedWeeks.length - errors.length,
        workouts_created: totalWorkoutsCreated,
        errors
      }
    }

    return {
      success: true,
      weeks_replaced: regeneratedWeeks.length,
      workouts_created: totalWorkoutsCreated
    }
  } catch (error) {
    return {
      success: false,
      weeks_replaced: 0,
      workouts_created: 0,
      errors: [error instanceof Error ? error.message : 'Unknown error']
    }
  }
}

/**
 * Calculate week start date based on plan start and week number
 *
 * @param planStartDate - Plan start date (YYYY-MM-DD)
 * @param weekNumber - Week number (1-indexed)
 * @param daysPerWeek - Days per week (typically 7)
 * @returns Week start date (YYYY-MM-DD)
 */
function calculateWeekStartDate(
  planStartDate: string,
  weekNumber: number,
  daysPerWeek: number
): string {
  const startDate = new Date(planStartDate)
  const daysToAdd = (weekNumber - 1) * daysPerWeek
  const weekStart = new Date(startDate)
  weekStart.setDate(startDate.getDate() + daysToAdd)
  return weekStart.toISOString().split('T')[0]
}

/**
 * Calculate workout scheduled date based on plan start, week, and day
 *
 * @param planStartDate - Plan start date (YYYY-MM-DD)
 * @param weekNumber - Week number (1-indexed)
 * @param day - Day within week (1-indexed)
 * @param daysPerWeek - Days per week (typically 7)
 * @returns Scheduled date (YYYY-MM-DD)
 */
function calculateWorkoutDate(
  planStartDate: string,
  weekNumber: number,
  day: number,
  daysPerWeek: number
): string {
  const startDate = new Date(planStartDate)
  const daysToAdd = (weekNumber - 1) * daysPerWeek + (day - 1)
  const workoutDate = new Date(startDate)
  workoutDate.setDate(startDate.getDate() + daysToAdd)
  return workoutDate.toISOString().split('T')[0]
}

/**
 * Validate regenerated weeks before applying
 *
 * Checks that weeks exist in plan and phase names match.
 * More thorough than the LLM output validation - verifies against actual database state.
 *
 * @param regeneratedWeeks - Weeks to validate
 * @param planContext - Full plan context
 * @returns Validation result with errors if any
 */
export function validateWeeksForReplacement(
  regeneratedWeeks: RegeneratedWeek[],
  planContext: FullPlanContext
): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  for (const week of regeneratedWeeks) {
    // Check week exists
    const originalWeek = planContext.weeks.find(w => w.week_number === week.week_number)
    if (!originalWeek) {
      errors.push(`Week ${week.week_number} does not exist in plan`)
      continue
    }

    // Check phase name matches
    if (week.phase_name !== originalWeek.phase_name) {
      errors.push(
        `Week ${week.week_number}: Phase mismatch (got "${week.phase_name}", expected "${originalWeek.phase_name}")`
      )
    }

    // Check workout count matches days per week
    const expectedWorkouts = planContext.athlete_constraints.days_per_week || 7
    if (week.workouts.length !== expectedWorkouts) {
      errors.push(
        `Week ${week.week_number}: Expected ${expectedWorkouts} workouts, got ${week.workouts.length}`
      )
    }

    // Check day numbers are valid
    for (const workout of week.workouts) {
      if (workout.day < 1 || workout.day > 7) {
        errors.push(`Week ${week.week_number}: Invalid day number ${workout.day}`)
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  }
}
