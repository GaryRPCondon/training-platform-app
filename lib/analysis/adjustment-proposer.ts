import { createClient } from '@/lib/supabase/client'
import { format, addDays } from 'date-fns'
import { saveAdjustmentProposal } from './adjustment-persistence'

export interface Adjustment {
    id: string
    type: 'reschedule' | 'reduce_volume' | 'add_recovery' | 'modify_workout'
    title: string
    description: string
    rationale: string
    impact: string
    targetWorkoutId?: number
    proposedChanges: any
}

export async function proposeAdjustments(athleteId: string): Promise<Adjustment[]> {
    const supabase = createClient()
    const adjustments: Adjustment[] = []
    const today = new Date()

    // Get current week's plan
    const { data: currentWeek } = await supabase
        .from('weekly_plans')
        .select('*')
        .eq('athlete_id', athleteId)
        .lte('week_start_date', format(today, 'yyyy-MM-dd'))
        .order('week_start_date', { ascending: false })
        .limit(1)
        .single()

    if (!currentWeek) return adjustments

    // Get this week's workouts
    const weekEnd = addDays(new Date(currentWeek.week_start_date), 7)
    const { data: workouts } = await supabase
        .from('planned_workouts')
        .select('*')
        .eq('athlete_id', athleteId)
        .gte('scheduled_date', currentWeek.week_start_date)
        .lt('scheduled_date', format(weekEnd, 'yyyy-MM-dd'))
        .order('scheduled_date', { ascending: true })

    // Get completed activities this week
    const { data: activities } = await supabase
        .from('activities')
        .select('*')
        .eq('athlete_id', athleteId)
        .gte('start_time', currentWeek.week_start_date)

    const completedCount = activities?.length || 0
    const totalWorkouts = workouts?.length || 0
    const missedCount = workouts?.filter(w =>
        new Date(w.scheduled_date) < today &&
        w.status === 'scheduled' &&
        !w.completed_activity_id
    ).length || 0

    // Proposal 1: If multiple workouts missed, suggest reducing volume
    if (missedCount >= 2 && totalWorkouts > 0) {
        const upcomingWorkouts = workouts?.filter(w => new Date(w.scheduled_date) >= today) || []

        if (upcomingWorkouts.length > 0) {
            const adjustment: Adjustment = {
                id: 'reduce-volume-1',
                type: 'reduce_volume',
                title: 'Reduce Remaining Volume',
                description: `Reduce volume by 20% for remaining workouts this week`,
                rationale: `You've missed ${missedCount} workouts this week. Reducing remaining volume helps prevent overload from trying to catch up.`,
                impact: 'Maintains consistency while avoiding injury risk from sudden volume spikes',
                proposedChanges: {
                    workouts: upcomingWorkouts.map(w => ({
                        id: w.id,
                        currentDistance: w.distance_target_meters,
                        newDistance: Math.round(w.distance_target_meters * 0.8)
                    }))
                }
            }
            adjustments.push(adjustment)

            // Save to database
            try {
                await saveAdjustmentProposal(
                    athleteId,
                    adjustment.type,
                    adjustment.title,
                    adjustment.description,
                    adjustment.rationale,
                    adjustment.impact,
                    upcomingWorkouts.map(w => w.id)
                )
            } catch (error) {
                console.error('Failed to save adjustment proposal:', error)
            }
        }
    }

    // Proposal 2: If high volume week and low completion, add recovery day
    const actualVolume = (activities?.reduce((sum, a) => sum + (a.distance_meters || 0), 0) || 0) / 1000
    const plannedVolume = currentWeek.weekly_volume_target || 0

    if (plannedVolume > 60 && completedCount < totalWorkouts * 0.6) {
        const upcomingHardWorkouts = workouts?.filter(w =>
            new Date(w.scheduled_date) >= today &&
            (w.workout_type === 'intervals' || w.workout_type === 'tempo')
        ) || []

        if (upcomingHardWorkouts.length > 0) {
            const adjustment: Adjustment = {
                id: 'add-recovery-1',
                type: 'add_recovery',
                title: 'Convert Hard Workout to Easy Run',
                description: `Convert ${upcomingHardWorkouts[0].workout_type} to easy recovery run`,
                rationale: 'Low completion rate this week suggests fatigue. Adding recovery helps prevent burnout.',
                impact: 'Reduces injury risk and improves long-term consistency',
                targetWorkoutId: upcomingHardWorkouts[0].id,
                proposedChanges: {
                    from: upcomingHardWorkouts[0].workout_type,
                    to: 'easy_run',
                    newDescription: 'Easy recovery run'
                }
            }
            adjustments.push(adjustment)

            // Save to database
            try {
                await saveAdjustmentProposal(
                    athleteId,
                    adjustment.type,
                    adjustment.title,
                    adjustment.description,
                    adjustment.rationale,
                    adjustment.impact,
                    [upcomingHardWorkouts[0].id]
                )
            } catch (error) {
                console.error('Failed to save adjustment proposal:', error)
            }
        }
    }

    // Proposal 3: If weekend long run is coming and week has been tough, suggest rescheduling
    const upcomingLongRun = workouts?.find(w =>
        w.workout_type === 'long_run' &&
        new Date(w.scheduled_date) >= today &&
        new Date(w.scheduled_date) <= addDays(today, 3)
    )

    if (upcomingLongRun && missedCount >= 2) {
        const adjustment: Adjustment = {
            id: 'reschedule-long-run-1',
            type: 'reschedule',
            title: 'Postpone Long Run',
            description: 'Move long run to next week',
            rationale: `With ${missedCount} missed workouts, your body may not be ready for a long run. Better to reschedule than risk injury.`,
            impact: 'Allows proper recovery and maintains training quality',
            targetWorkoutId: upcomingLongRun.id,
            proposedChanges: {
                currentDate: upcomingLongRun.scheduled_date,
                newDate: format(addDays(new Date(upcomingLongRun.scheduled_date), 7), 'yyyy-MM-dd')
            }
        }
        adjustments.push(adjustment)

        // Save to database
        try {
            await saveAdjustmentProposal(
                athleteId,
                adjustment.type,
                adjustment.title,
                adjustment.description,
                adjustment.rationale,
                adjustment.impact,
                [upcomingLongRun.id]
            )
        } catch (error) {
            console.error('Failed to save adjustment proposal:', error)
        }
    }

    return adjustments
}
