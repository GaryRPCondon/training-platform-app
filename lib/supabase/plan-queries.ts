import { createClient } from './client'
import { GeneratedPlan } from '@/lib/planning/plan-generator'

/**
 * Save a complete training plan with all phases, weekly plans, and workouts
 */
export async function savePlanWithPhases(generatedPlan: GeneratedPlan, athleteId: string) {
    const supabase = createClient()

    try {
        // 1. Insert the goal first
        console.log('=== INSERTING GOAL ===')
        console.log('Goal data:', JSON.stringify({
            ...generatedPlan.goal,
            athlete_id: athleteId
        }, null, 2))

        const { data: goalData, error: goalError } = await supabase
            .from('athlete_goals')
            .insert({
                ...generatedPlan.goal,
                athlete_id: athleteId
            })
            .select()
            .single()

        if (goalError) {
            console.error('=== GOAL INSERT FAILED ===')
            console.error('Error message:', goalError.message)
            console.error('Error code:', goalError.code)
            console.error('Error details:', goalError.details)
            console.error('Full error:', JSON.stringify(goalError, null, 2))
            throw goalError
        }
        console.log('✓ Goal inserted successfully, ID:', goalData.id)

        // 2. Insert the training plan with goal_id
        console.log('=== INSERTING TRAINING PLAN ===')
        const planInsertData = {
            ...generatedPlan.plan,
            goal_id: goalData.id,
            athlete_id: athleteId
        }
        console.log('Plan data:', JSON.stringify(planInsertData, null, 2))

        const { data: planData, error: planError } = await supabase
            .from('training_plans')
            .insert(planInsertData)
            .select()
            .single()

        if (planError) {
            console.error('=== PLAN INSERT FAILED ===')
            console.error('Error message:', planError.message)
            console.error('Error code:', planError.code)
            console.error('Error details:', planError.details)
            console.error('Full error:', JSON.stringify(planError, null, 2))
            throw planError
        }
        console.log('✓ Training plan inserted successfully, ID:', planData.id)

        // 3. Insert phases
        console.log('=== INSERTING PHASES ===')
        const phasesWithPlanId = generatedPlan.phases.map(phase => ({
            ...phase,
            plan_id: planData.id
        }))
        console.log('Phases data (count:', phasesWithPlanId.length, '):', JSON.stringify(phasesWithPlanId[0], null, 2))

        const { data: phasesData, error: phasesError } = await supabase
            .from('training_phases')
            .insert(phasesWithPlanId)
            .select()

        if (phasesError) {
            console.error('=== PHASES INSERT FAILED ===')
            console.error('Error message:', phasesError.message)
            console.error('Error code:', phasesError.code)
            console.error('Error details:', phasesError.details)
            console.error('Full error:', JSON.stringify(phasesError, null, 2))
            throw phasesError
        }
        console.log('✓ Phases inserted successfully, count:', phasesData.length)

        // 4. Insert weekly plans
        console.log('=== INSERTING WEEKLY PLANS ===')
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
        console.log('Weekly plans data (count:', weeklyPlansWithPhaseId.length, '):', JSON.stringify(weeklyPlansWithPhaseId[0], null, 2))

        const { data: weeklyPlansData, error: weeklyPlansError } = await supabase
            .from('weekly_plans')
            .insert(weeklyPlansWithPhaseId)
            .select()

        if (weeklyPlansError) {
            console.error('=== WEEKLY PLANS INSERT FAILED ===')
            console.error('Error message:', weeklyPlansError.message)
            console.error('Error code:', weeklyPlansError.code)
            console.error('Error details:', weeklyPlansError.details)
            console.error('Full error:', JSON.stringify(weeklyPlansError, null, 2))
            throw weeklyPlansError
        }
        console.log('✓ Weekly plans inserted successfully, count:', weeklyPlansData.length)

        // 5. Insert workouts
        console.log('=== INSERTING WORKOUTS ===')
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
        console.log('Workouts data (count:', workoutsWithWeeklyPlanId.length, '):', JSON.stringify(workoutsWithWeeklyPlanId[0], null, 2))

        const { error: workoutsError } = await supabase
            .from('planned_workouts')
            .insert(workoutsWithWeeklyPlanId)

        if (workoutsError) {
            console.error('=== WORKOUTS INSERT FAILED ===')
            console.error('Error message:', workoutsError.message)
            console.error('Error code:', workoutsError.code)
            console.error('Error details:', workoutsError.details)
            console.error('Full error:', JSON.stringify(workoutsError, null, 2))
            throw workoutsError
        }
        console.log('✓ Workouts inserted successfully')
        console.log('=== PLAN CREATION COMPLETE ===')

        return { success: true, planId: planData.id }
    } catch (error) {
        console.error('=== PLAN CREATION FAILED ===')
        console.error('Error:', error)
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
