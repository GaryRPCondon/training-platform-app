import { createClient } from '@/lib/supabase/client'

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
