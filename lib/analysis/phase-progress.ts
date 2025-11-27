import { createClient } from '@/lib/supabase/client'
import { differenceInWeeks, format } from 'date-fns'

export interface PhaseProgress {
    phaseName: string
    phaseDescription: string
    currentWeek: number
    totalWeeks: number
    percentComplete: number
    weeklyVolumeTarget: number
    weeklyVolumeActual: number
    volumePercentComplete: number
    upcomingMilestone?: string
}

export async function getPhaseProgress(athleteId: string): Promise<PhaseProgress | null> {
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

    // Calculate phase progress
    const phaseStart = new Date(currentPhase.start_date)
    const phaseEnd = new Date(currentPhase.end_date)
    const currentWeek = differenceInWeeks(new Date(), phaseStart) + 1
    const totalWeeks = differenceInWeeks(phaseEnd, phaseStart) + 1
    const percentComplete = Math.round((currentWeek / totalWeeks) * 100)

    // Get current week's plan
    const { data: weeklyPlan } = await supabase
        .from('weekly_plans')
        .select('*')
        .eq('athlete_id', athleteId)
        .lte('week_start_date', today)
        .order('week_start_date', { ascending: false })
        .limit(1)
        .single()

    let weeklyVolumeActual = 0
    if (weeklyPlan) {
        const { data: thisWeekActivities } = await supabase
            .from('activities')
            .select('distance_meters')
            .eq('athlete_id', athleteId)
            .gte('start_time', weeklyPlan.week_start_date)

        weeklyVolumeActual = (thisWeekActivities?.reduce((sum, a) => sum + (a.distance_meters || 0), 0) || 0) / 1000
    }

    const weeklyVolumeTarget = weeklyPlan?.weekly_volume_target || 0
    const volumePercentComplete = weeklyVolumeTarget > 0
        ? Math.round((weeklyVolumeActual / weeklyVolumeTarget) * 100)
        : 0

    // Determine upcoming milestone
    let upcomingMilestone: string | undefined
    if (currentPhase.phase_name.toLowerCase() === 'base') {
        upcomingMilestone = 'Build phase starts soon - intensity increases'
    } else if (currentPhase.phase_name.toLowerCase() === 'build') {
        upcomingMilestone = 'Peak phase approaching - race-specific work'
    } else if (currentPhase.phase_name.toLowerCase() === 'peak') {
        upcomingMilestone = 'Taper phase next - time to rest'
    } else if (currentPhase.phase_name.toLowerCase() === 'taper') {
        upcomingMilestone = 'Race week! Stay fresh and trust your training'
    }

    return {
        phaseName: currentPhase.phase_name,
        phaseDescription: currentPhase.description,
        currentWeek,
        totalWeeks,
        percentComplete,
        weeklyVolumeTarget: Math.round(weeklyVolumeTarget),
        weeklyVolumeActual: Math.round(weeklyVolumeActual),
        volumePercentComplete,
        upcomingMilestone
    }
}
export interface DailyProgress {
    date: string
    dayName: string
    plannedDistance: number
    actualDistance: number
    status: 'completed' | 'missed' | 'planned' | 'none'
}

export async function getWeeklyProgress(athleteId: string): Promise<DailyProgress[]> {
    const supabase = createClient()
    const today = new Date()
    const weekStart = format(today, 'yyyy-MM-dd') // This should be start of week, but let's stick to current week logic
    // Actually, let's get the real start of week (Monday)
    const realWeekStart = new Date(today)
    const day = realWeekStart.getDay()
    const diff = realWeekStart.getDate() - day + (day === 0 ? -6 : 1) // adjust when day is sunday
    realWeekStart.setDate(diff)
    const startDateStr = format(realWeekStart, 'yyyy-MM-dd')

    // Get planned workouts for this week
    const { data: workouts } = await supabase
        .from('planned_workouts')
        .select('*')
        .eq('athlete_id', athleteId)
        .gte('scheduled_date', startDateStr)
        .lte('scheduled_date', format(addDays(realWeekStart, 6), 'yyyy-MM-dd'))

    // Get activities for this week
    const { data: activities } = await supabase
        .from('activities')
        .select('*')
        .eq('athlete_id', athleteId)
        .gte('start_time', startDateStr)
        .lte('start_time', format(addDays(realWeekStart, 6), 'yyyy-MM-dd'))

    const progress: DailyProgress[] = []
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

    for (let i = 0; i < 7; i++) {
        const currentDate = addDays(realWeekStart, i)
        const dateStr = format(currentDate, 'yyyy-MM-dd')

        const dayWorkout = workouts?.find(w => w.scheduled_date === dateStr)
        const dayActivity = activities?.find(a => a.start_time.startsWith(dateStr))

        let status: DailyProgress['status'] = 'none'
        if (dayActivity) status = 'completed'
        else if (dayWorkout && new Date(dateStr) < today) status = 'missed'
        else if (dayWorkout) status = 'planned'

        progress.push({
            date: dateStr,
            dayName: days[i],
            plannedDistance: dayWorkout?.distance_target_meters ? Math.round(dayWorkout.distance_target_meters / 1000) : 0,
            actualDistance: dayActivity?.distance_meters ? Math.round(dayActivity.distance_meters / 1000) : 0,
            status
        })
    }

    return progress
}

function addDays(date: Date, days: number): Date {
    const result = new Date(date)
    result.setDate(result.getDate() + days)
    return result
}
