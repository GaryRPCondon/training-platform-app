import { createClient } from '@/lib/supabase/client'
import { subDays, subMonths, format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, differenceInWeeks } from 'date-fns'

export async function loadAgentContext(athleteId: string) {
    const daily = await loadDailyContext(athleteId)
    const weekly = await loadWeeklyContext(athleteId)
    const monthly = await loadMonthlyContext(athleteId)
    const phase = await loadPhaseContext(athleteId)
    const plan = await loadPlanContext(athleteId)
    const athlete = await loadAthleteProfile(athleteId)
    const personalRecords = await loadPersonalRecords(athleteId)
    const constraints = await loadActiveConstraints(athleteId)
    const recentFeedback = await loadRecentFeedback(athleteId)

    return {
        athlete,
        daily,
        weekly,
        monthly,
        phase,
        plan,
        personalRecords,
        constraints,
        recentFeedback
    }
}

async function loadAthleteProfile(athleteId: string) {
    const supabase = createClient()

    const { data } = await supabase
        .from('athletes')
        .select('*')
        .eq('id', athleteId)
        .single()

    return data
}

async function loadDailyContext(athleteId: string) {
    const supabase = createClient()
    const today = format(new Date(), 'yyyy-MM-dd')
    const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd')

    // Today's planned workout
    const { data: todayWorkout } = await supabase
        .from('planned_workouts')
        .select('*')
        .eq('athlete_id', athleteId)
        .eq('scheduled_date', today)
        .single()

    // Yesterday's completed activity
    const { data: yesterdayActivity } = await supabase
        .from('activities')
        .select('*')
        .eq('athlete_id', athleteId)
        .gte('start_time', yesterday)
        .lt('start_time', today)
        .order('start_time', { ascending: false })
        .limit(1)
        .single()

    return {
        todayWorkout,
        yesterdayActivity
    }
}

async function loadWeeklyContext(athleteId: string) {
    const supabase = createClient()
    const today = new Date()
    const weekStart = format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd')
    const weekEnd = format(endOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd')

    // Current week's plan
    const { data: weeklyPlan } = await supabase
        .from('weekly_plans')
        .select('*')
        .eq('athlete_id', athleteId)
        .eq('week_start_date', weekStart)
        .single()

    // Planned workouts for the week
    const { data: plannedWorkouts } = await supabase
        .from('planned_workouts')
        .select('*')
        .eq('athlete_id', athleteId)
        .gte('scheduled_date', weekStart)
        .lte('scheduled_date', weekEnd)
        .order('scheduled_date', { ascending: true })

    // Completed activities this week
    const { data: completedActivities } = await supabase
        .from('activities')
        .select('*')
        .eq('athlete_id', athleteId)
        .gte('start_time', weekStart)
        .lte('start_time', weekEnd)

    const completedWorkouts = completedActivities?.length || 0
    const totalWorkouts = plannedWorkouts?.length || 0

    return {
        weeklyPlan,
        plannedWorkouts,
        completedActivities,
        completedWorkouts,
        totalWorkouts,
        volumeTarget: weeklyPlan?.weekly_volume_target || 0
    }
}

async function loadMonthlyContext(athleteId: string) {
    const supabase = createClient()
    const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd')
    const monthEnd = format(endOfMonth(new Date()), 'yyyy-MM-dd')
    const lastMonthStart = format(startOfMonth(subMonths(new Date(), 1)), 'yyyy-MM-dd')
    const lastMonthEnd = format(endOfMonth(subMonths(new Date(), 1)), 'yyyy-MM-dd')

    // This month's activities
    const { data: thisMonthActivities } = await supabase
        .from('activities')
        .select('distance_meters')
        .eq('athlete_id', athleteId)
        .gte('start_time', monthStart)
        .lte('start_time', monthEnd)

    // Last month's activities
    const { data: lastMonthActivities } = await supabase
        .from('activities')
        .select('distance_meters')
        .eq('athlete_id', athleteId)
        .gte('start_time', lastMonthStart)
        .lte('start_time', lastMonthEnd)

    const thisMonthDistance = (thisMonthActivities?.reduce((sum, a) => sum + (a.distance_meters || 0), 0) || 0) / 1000
    const lastMonthDistance = (lastMonthActivities?.reduce((sum, a) => sum + (a.distance_meters || 0), 0) || 0) / 1000

    const trend = thisMonthDistance > lastMonthDistance ? 'increasing' :
        thisMonthDistance < lastMonthDistance ? 'decreasing' : 'stable'

    return {
        totalDistance: Math.round(thisMonthDistance),
        lastMonthDistance: Math.round(lastMonthDistance),
        trend
    }
}

async function loadPhaseContext(athleteId: string) {
    const supabase = createClient()
    const today = format(new Date(), 'yyyy-MM-dd')

    // Get active plan
    const { data: activePlan } = await supabase
        .from('training_plans')
        .select('id')
        .eq('athlete_id', athleteId)
        .eq('status', 'active')
        .single()

    if (!activePlan) return null

    // Get current phase
    const { data: currentPhase } = await supabase
        .from('training_phases')
        .select('*')
        .eq('plan_id', activePlan.id)
        .lte('start_date', today)
        .gte('end_date', today)
        .single()

    if (!currentPhase) return null

    const phaseStart = new Date(currentPhase.start_date)
    const phaseEnd = new Date(currentPhase.end_date)
    const currentWeek = differenceInWeeks(new Date(), phaseStart) + 1
    const totalWeeks = differenceInWeeks(phaseEnd, phaseStart) + 1

    return {
        name: currentPhase.phase_name,
        description: currentPhase.description,
        currentWeek,
        totalWeeks,
        volumeTarget: currentPhase.weekly_volume_target
    }
}

async function loadPlanContext(athleteId: string) {
    const supabase = createClient()

    const { data: activePlan } = await supabase
        .from('training_plans')
        .select('*')
        .eq('athlete_id', athleteId)
        .eq('status', 'active')
        .single()

    if (!activePlan) return null

    const goalDate = new Date(activePlan.end_date)
    const today = new Date()
    const weeksRemaining = Math.ceil(differenceInWeeks(goalDate, today))

    return {
        name: activePlan.name,
        goalDate: format(goalDate, 'yyyy-MM-dd'),
        weeksRemaining,
        planType: activePlan.plan_type
    }
}

async function loadPersonalRecords(athleteId: string) {
    const supabase = createClient()

    // Get fastest times at common distances
    const distances = [5000, 10000, 21097, 42195] // 5k, 10k, half, full
    const records: Record<string, any> = {}

    for (const distance of distances) {
        const { data } = await supabase
            .from('activities')
            .select('distance_meters, duration_seconds, start_time')
            .eq('athlete_id', athleteId)
            .gte('distance_meters', distance * 0.98) // Within 2% of distance
            .lte('distance_meters', distance * 1.02)
            .order('duration_seconds', { ascending: true })
            .limit(1)
            .single()

        if (data) {
            const distanceLabel = distance === 5000 ? '5k' :
                distance === 10000 ? '10k' :
                    distance === 21097 ? 'half_marathon' : 'marathon'
            records[distanceLabel] = {
                time: data.duration_seconds,
                pace: (data.duration_seconds / 60) / (data.distance_meters / 1000),
                date: data.start_time
            }
        }
    }

    return records
}

async function loadActiveConstraints(athleteId: string) {
    const supabase = createClient()

    const { data } = await supabase
        .from('athlete_constraints')
        .select('*')
        .eq('athlete_id', athleteId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })

    return data || []
}

async function loadRecentFeedback(athleteId: string) {
    const supabase = createClient()
    const sevenDaysAgo = format(subDays(new Date(), 7), 'yyyy-MM-dd')

    const { data } = await supabase
        .from('workout_feedback')
        .select(`
            *,
            planned_workout:planned_workouts(
                workout_type,
                scheduled_date
            )
        `)
        .eq('athlete_id', athleteId)
        .gte('created_at', sevenDaysAgo)
        .order('created_at', { ascending: false })
        .limit(10)

    return data || []
}
