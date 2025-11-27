import { createClient } from './client'
import { GeneratedPlan } from '@/lib/planning/plan-generator'

/**
 * Save a complete training plan with all phases, weekly plans, and workouts
 */
export async function savePlanWithPhases(generatedPlan: GeneratedPlan, athleteId: string) {
    const supabase = createClient()

    try {
        // 1. Insert the goal first
        const { data: goalData, error: goalError } = await supabase
            .from('athlete_goals')
            .insert({
                ...generatedPlan.goal,
                athlete_id: athleteId
            })
            .select()
            .single()

        if (goalError) throw goalError

        // 2. Insert the training plan with goal_id
        const { data: planData, error: planError } = await supabase
            .from('training_plans')
            .insert({
                ...generatedPlan.plan,
                goal_id: goalData.id,
                athlete_id: athleteId
            })
            .select()
            .single()

        if (planError) throw planError

        // 2. Insert phases
        const phasesWithPlanId = generatedPlan.phases.map(phase => ({
            ...phase,
            plan_id: planData.id
        }))

        const { data: phasesData, error: phasesError } = await supabase
            .from('training_phases')
            .insert(phasesWithPlanId)
            .select()

        if (phasesError) throw phasesError

        // 3. Insert weekly plans
        // Map weekly plans to their phases based on dates
        const weeklyPlansWithPhaseId = generatedPlan.weeklyPlans.map(weeklyPlan => {
            const phase = phasesData.find(p => {
                const weekDate = new Date(weeklyPlan.week_start_date)
                const phaseStart = new Date(p.start_date)
                const phaseEnd = new Date(p.end_date)
                return weekDate >= phaseStart && weekDate < phaseEnd
            })

            return {
                ...weeklyPlan,
                phase_id: phase?.id || null,
                athlete_id: athleteId
            }
        })

        const { data: weeklyPlansData, error: weeklyPlansError } = await supabase
            .from('weekly_plans')
            .insert(weeklyPlansWithPhaseId)
            .select()

        if (weeklyPlansError) throw weeklyPlansError

        // 4. Insert workouts
        // Map workouts to their weekly plans based on dates
        const workoutsWithWeeklyPlanId = generatedPlan.workouts.map(workout => {
            const weeklyPlan = weeklyPlansData.find(wp => {
                const workoutDate = new Date(workout.scheduled_date)
                const weekStart = new Date(wp.week_start_date)
                const weekEnd = new Date(weekStart)
                weekEnd.setDate(weekEnd.getDate() + 7)
                return workoutDate >= weekStart && workoutDate < weekEnd
            })

            return {
                ...workout,
                weekly_plan_id: weeklyPlan?.id || null,
                athlete_id: athleteId
            }
        })

        const { error: workoutsError } = await supabase
            .from('planned_workouts')
            .insert(workoutsWithWeeklyPlanId)

        if (workoutsError) throw workoutsError

        return { success: true, planId: planData.id }
    } catch (error) {
        console.error('Error saving plan:', error)
        throw error
    }
}

/**
 * Get a training plan with all its details
 */
export async function getPlanWithDetails(planId: number) {
    const supabase = createClient()

    const { data: plan, error: planError } = await supabase
        .from('training_plans')
        .select(`
            *,
            phases:training_phases(
                *,
                weekly_plans(
                    *,
                    workouts:planned_workouts(*)
                )
            )
        `)
        .eq('id', planId)
        .single()

    if (planError) throw planError
    return plan
}

/**
 * Get all training plans for an athlete
 */
export async function getAthletePlans(athleteId: string) {
    const supabase = createClient()

    const { data, error } = await supabase
        .from('training_plans')
        .select('*')
        .eq('athlete_id', athleteId)
        .order('created_at', { ascending: false })

    if (error) throw error
    return data
}
