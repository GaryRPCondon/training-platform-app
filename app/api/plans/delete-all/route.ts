import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function DELETE() {
    try {
        const supabase = await createClient()

        // Get current user
        const { data: { user }, error: userError } = await supabase.auth.getUser()
        if (userError || !user) {
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
        }

        // Delete in the correct order to respect foreign key constraints
        // 1. Delete planned workouts
        const { error: workoutsError } = await supabase
            .from('planned_workouts')
            .delete()
            .eq('athlete_id', user.id)

        if (workoutsError) {
            console.error('Error deleting workouts:', workoutsError)
            return NextResponse.json({ error: workoutsError.message }, { status: 500 })
        }

        // 2. Delete weekly plans
        const { error: weeklyError } = await supabase
            .from('weekly_plans')
            .delete()
            .eq('athlete_id', user.id)

        if (weeklyError) {
            console.error('Error deleting weekly plans:', weeklyError)
            return NextResponse.json({ error: weeklyError.message }, { status: 500 })
        }

        // 3. Get all plan IDs for this athlete to delete phases
        const { data: plans } = await supabase
            .from('training_plans')
            .select('id')
            .eq('athlete_id', user.id)

        if (plans && plans.length > 0) {
            const planIds = plans.map(p => p.id)

            // 4. Delete training phases
            const { error: phasesError } = await supabase
                .from('training_phases')
                .delete()
                .in('plan_id', planIds)

            if (phasesError) {
                console.error('Error deleting phases:', phasesError)
                return NextResponse.json({ error: phasesError.message }, { status: 500 })
            }
        }

        // 5. Count plans before deleting
        const { count: plansCount } = await supabase
            .from('training_plans')
            .select('*', { count: 'exact', head: true })
            .eq('athlete_id', user.id)

        // Delete training plans
        const { error: plansError } = await supabase
            .from('training_plans')
            .delete()
            .eq('athlete_id', user.id)

        if (plansError) {
            console.error('Error deleting plans:', plansError)
            return NextResponse.json({ error: plansError.message }, { status: 500 })
        }

        // 6. Delete athlete goals
        const { error: goalsError } = await supabase
            .from('athlete_goals')
            .delete()
            .eq('athlete_id', user.id)

        if (goalsError) {
            console.error('Error deleting goals:', goalsError)
            return NextResponse.json({ error: goalsError.message }, { status: 500 })
        }

        return NextResponse.json({
            success: true,
            count: plansCount || 0,
            message: 'All plans and related data deleted successfully'
        })
    } catch (error) {
        console.error('Error in delete-all plans:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
