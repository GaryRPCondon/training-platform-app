import { createClient } from '@/lib/supabase/client'

/**
 * Save adjustment proposals to database
 */
export async function saveAdjustmentProposal(
    athleteId: string,
    adjustmentType: string,
    title: string,
    description: string,
    rationale: string,
    impact: string,
    affectedWorkoutIds: number[]
): Promise<void> {
    const supabase = createClient()

    const { error } = await supabase
        .from('plan_adjustments')
        .insert({
            athlete_id: athleteId,
            adjustment_type: adjustmentType,
            title,
            description,
            rationale,
            impact,
            affected_workout_ids: affectedWorkoutIds,
            agent_recommended: true,
            status: 'pending',
            created_at: new Date().toISOString()
        })

    if (error) throw error
}

/**
 * Apply an approved adjustment
 */
export async function applyAdjustment(adjustmentId: number): Promise<void> {
    const supabase = createClient()

    // Get the adjustment details
    const { data: adjustment, error: fetchError } = await supabase
        .from('plan_adjustments')
        .select('*')
        .eq('id', adjustmentId)
        .single()

    if (fetchError) throw fetchError

    // Apply based on adjustment type
    switch (adjustment.adjustment_type) {
        case 'reduce_volume':
            // Reduce distance targets for affected workouts
            if (adjustment.affected_workout_ids) {
                const { error } = await supabase
                    .from('planned_workouts')
                    .update({
                        distance_target_meters: supabase.rpc('multiply_distance', {
                            workout_id: adjustment.affected_workout_ids,
                            factor: 0.75
                        })
                    })
                    .in('id', adjustment.affected_workout_ids)

                if (error) console.error('Error reducing volume:', error)
            }
            break

        case 'add_recovery':
            // Convert workouts to easy runs
            if (adjustment.affected_workout_ids) {
                const { error } = await supabase
                    .from('planned_workouts')
                    .update({
                        workout_type: 'easy_run',
                        intensity_target: 'easy',
                        structured_workout: null
                    })
                    .in('id', adjustment.affected_workout_ids)

                if (error) console.error('Error adding recovery:', error)
            }
            break

        case 'reschedule':
            // This would require more complex logic to shift dates
            // For now, just mark as acknowledged
            break
    }

    // Mark adjustment as applied
    const { error: updateError } = await supabase
        .from('plan_adjustments')
        .update({
            status: 'applied',
            applied_at: new Date().toISOString()
        })
        .eq('id', adjustmentId)

    if (updateError) throw updateError
}

/**
 * Reject an adjustment proposal
 */
export async function rejectAdjustment(adjustmentId: number): Promise<void> {
    const supabase = createClient()

    const { error } = await supabase
        .from('plan_adjustments')
        .update({
            status: 'rejected',
            applied_at: new Date().toISOString()
        })
        .eq('id', adjustmentId)

    if (error) throw error
}
