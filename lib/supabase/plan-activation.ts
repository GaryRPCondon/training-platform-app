import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Archive a plan and abandon its linked goal. Used when the user replaces an
 * active plan with a newly generated one. Accepts a supabase client so it can
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
 * Activate a training plan (sets it to active and deactivates others)
 */
export async function activatePlan(planId: number, athleteId: string): Promise<void> {
    const supabase = createClient()

    try {
        // First, deactivate all other plans for this athlete
        const { error: deactivateError } = await supabase
            .from('training_plans')
            .update({ status: 'draft' })
            .eq('athlete_id', athleteId)
            .eq('status', 'active')

        if (deactivateError) throw deactivateError

        // Then activate the selected plan
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
 * Deactivate a training plan
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
