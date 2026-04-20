import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'

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
