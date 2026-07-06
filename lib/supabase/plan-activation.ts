import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * True if the two closed date ranges [aStart, aEnd] and [bStart, bEnd] overlap.
 * Dates are YYYY-MM-DD strings, so lexicographic comparison is chronological.
 */
export function plansOverlap(
    aStart: string,
    aEnd: string,
    bStart: string,
    bEnd: string
): boolean {
    return aStart <= bEnd && bStart <= aEnd
}

/**
 * Truncate a plan at `cutoffDate` (YYYY-MM-DD) and archive it. Used when a new,
 * overlapping plan supersedes the current one: the old plan is shortened to end
 * the day before the new plan starts, and its weekly_plans (plus their scheduled
 * workouts) dated on/after the cutoff are deleted — which frees the
 * (athlete_id, week_start_date) slots the incoming plan needs. Everything before
 * the cutoff, plus completed/rescheduled workouts, is preserved as history, so
 * the plan stays reactivatable.
 *
 * Server-context only (used by the plan-generation engine): the weekly_plans
 * lookup is scoped via the plan's phases, relying on RLS for athlete isolation.
 *
 * NOTE: workouts already pushed to Garmin are not automatically removed from the
 * watch here (parity with plan deletion); the user can remove them from Garmin.
 */
export async function truncateAndArchivePlan(
    supabase: SupabaseClient,
    planId: number,
    athleteId: string,
    cutoffDate: string
): Promise<void> {
    // Resolve the plan's weekly_plans on/after the cutoff via plan → phases → weeks.
    const { data: phases, error: phasesError } = await supabase
        .from('training_phases')
        .select('id')
        .eq('plan_id', planId)
    if (phasesError) throw phasesError

    const phaseIds = (phases ?? []).map(p => p.id)
    if (phaseIds.length > 0) {
        const { data: weeks, error: weeksError } = await supabase
            .from('weekly_plans')
            .select('id')
            .in('phase_id', phaseIds)
            .gte('week_start_date', cutoffDate)
        if (weeksError) throw weeksError

        const weekIds = (weeks ?? []).map(w => w.id)
        if (weekIds.length > 0) {
            // Keep completed/rescheduled/skipped workouts as orphaned history so the
            // cascade from deleting the weekly_plan doesn't take them with it.
            const { error: orphanError } = await supabase
                .from('planned_workouts')
                .update({ weekly_plan_id: null })
                .in('weekly_plan_id', weekIds)
                .neq('status', 'scheduled')
            if (orphanError) throw orphanError

            // Delete the weekly_plans (cascade removes the remaining scheduled workouts).
            const { error: delError } = await supabase
                .from('weekly_plans')
                .delete()
                .in('id', weekIds)
            if (delError) throw delError
        }
    }

    // Shorten the plan to end the day before the cutoff.
    const end = new Date(cutoffDate + 'T00:00:00')
    end.setDate(end.getDate() - 1)
    const newEndDate = end.toISOString().slice(0, 10)

    const { data: plan, error: fetchError } = await supabase
        .from('training_plans')
        .select('goal_id')
        .eq('id', planId)
        .eq('athlete_id', athleteId)
        .single()
    if (fetchError) throw fetchError

    const { error: planError } = await supabase
        .from('training_plans')
        .update({ status: 'archived', end_date: newEndDate })
        .eq('id', planId)
        .eq('athlete_id', athleteId)
    if (planError) throw planError

    if (plan?.goal_id) {
        const { error: goalError } = await supabase
            .from('athlete_goals')
            .update({ status: 'abandoned' })
            .eq('id', plan.goal_id)
            .eq('athlete_id', athleteId)
        if (goalError) throw goalError
    }
}

/**
 * Archive a plan and abandon its linked goal. Used when the user replaces an
 * active plan mid-cycle (before end_date). Accepts a supabase client so it can
 * be called from API routes (server client) or browser code (client client).
 */
export async function archivePlanAndGoal(
    supabase: SupabaseClient,
    planId: number,
    athleteId: string
): Promise<void> {
    const { data: plan, error: fetchError } = await supabase
        .from('training_plans')
        .select('goal_id')
        .eq('id', planId)
        .eq('athlete_id', athleteId)
        .single()
    if (fetchError) throw fetchError

    const { error: planError } = await supabase
        .from('training_plans')
        .update({ status: 'archived' })
        .eq('id', planId)
        .eq('athlete_id', athleteId)
    if (planError) throw planError

    if (plan?.goal_id) {
        const { error: goalError } = await supabase
            .from('athlete_goals')
            .update({ status: 'abandoned' })
            .eq('id', plan.goal_id)
            .eq('athlete_id', athleteId)
        if (goalError) throw goalError
    }
}

/**
 * Mark a plan as completed and mark its linked goal as achieved.
 * Used when the plan's end_date has passed and the athlete finished the cycle.
 */
export async function completePlan(
    supabase: SupabaseClient,
    planId: number,
    athleteId: string
): Promise<void> {
    const { data: plan, error: fetchError } = await supabase
        .from('training_plans')
        .select('goal_id')
        .eq('id', planId)
        .eq('athlete_id', athleteId)
        .single()
    if (fetchError) throw fetchError

    const { error: planError } = await supabase
        .from('training_plans')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', planId)
        .eq('athlete_id', athleteId)
    if (planError) throw planError

    if (plan?.goal_id) {
        const { error: goalError } = await supabase
            .from('athlete_goals')
            .update({ status: 'achieved' })
            .eq('id', plan.goal_id)
            .eq('athlete_id', athleteId)
        if (goalError) throw goalError
    }
}

/**
 * Activate a training plan (sets it to active and transitions the previous
 * active plan to completed or archived depending on whether its end_date has passed).
 */
export async function activatePlan(planId: number, athleteId: string): Promise<void> {
    const supabase = createClient()

    try {
        // Find the currently active plan (if any) to transition it correctly
        const { data: currentActive } = await supabase
            .from('training_plans')
            .select('id, end_date')
            .eq('athlete_id', athleteId)
            .eq('status', 'active')
            .maybeSingle()

        if (currentActive) {
            const today = new Date().toISOString().slice(0, 10)
            if (currentActive.end_date < today) {
                // Plan's cycle is over — mark it as completed (achievement preserved)
                await completePlan(supabase, currentActive.id, athleteId)
            } else {
                // Plan replaced mid-cycle — archive it
                await archivePlanAndGoal(supabase, currentActive.id, athleteId)
            }
        }

        // Activate the selected plan
        const { error: activateError } = await supabase
            .from('training_plans')
            .update({ status: 'active' })
            .eq('id', planId)
            .eq('athlete_id', athleteId)

        if (activateError) throw activateError
    } catch (error) {
        console.error('Error activating plan:', error)
        throw error
    }
}

/**
 * Deactivate a training plan (set back to draft)
 */
export async function deactivatePlan(planId: number, athleteId: string): Promise<void> {
    const supabase = createClient()

    const { error } = await supabase
        .from('training_plans')
        .update({ status: 'draft' })
        .eq('id', planId)
        .eq('athlete_id', athleteId)

    if (error) throw error
}
