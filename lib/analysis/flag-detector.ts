import { createClient } from '@/lib/supabase/client'
import { subDays, format, differenceInDays } from 'date-fns'
import { createObservation } from './observation-manager'

export interface Flag {
    id: string
    type: string
    severity: 'info' | 'warning' | 'concern'
    message: string
    data?: any
    created_at: string
}

export async function detectWorkoutFlags(athleteId: string): Promise<Flag[]> {
    const supabase = createClient()
    const flags: Flag[] = []
    const today = new Date()
    const sevenDaysAgo = format(subDays(today, 7), 'yyyy-MM-dd')
    const thirtyDaysAgo = format(subDays(today, 30), 'yyyy-MM-dd')

    // 1. Check for missed workouts (scheduled but not completed)
    const { data: missedWorkouts } = await supabase
        .from('planned_workouts')
        .select('*')
        .eq('athlete_id', athleteId)
        .eq('status', 'scheduled')
        .lt('scheduled_date', format(today, 'yyyy-MM-dd'))
        .gte('scheduled_date', sevenDaysAgo)
        .is('completed_activity_id', null)

    if (missedWorkouts && missedWorkouts.length > 0) {
        const observation = await createObservation(
            athleteId,
            'missed_workouts',
            missedWorkouts.length >= 3 ? 'concern' : 'warning',
            `${missedWorkouts.length} workout${missedWorkouts.length > 1 ? 's' : ''} missed in the last 7 days`,
            { count: missedWorkouts.length, workouts: missedWorkouts.map(w => w.scheduled_date) }
        )
        flags.push(observation)
    }

    // 2. Check for volume gap (actual vs planned)
    const { data: thisWeekPlan } = await supabase
        .from('weekly_plans')
        .select('*')
        .eq('athlete_id', athleteId)
        .lte('week_start_date', format(today, 'yyyy-MM-dd'))
        .gte('week_start_date', sevenDaysAgo)
        .single()

    if (thisWeekPlan) {
        const { data: thisWeekActivities } = await supabase
            .from('activities')
            .select('distance_meters')
            .eq('athlete_id', athleteId)
            .gte('start_time', thisWeekPlan.week_start_date)

        const actualVolume = (thisWeekActivities?.reduce((sum, a) => sum + (a.distance_meters || 0), 0) || 0) / 1000
        const plannedVolume = thisWeekPlan.weekly_volume_target || 0
        const gap = plannedVolume - actualVolume

        if (gap > plannedVolume * 0.3 && plannedVolume > 0) {
            const observation = await createObservation(
                athleteId,
                'volume_gap',
                gap > plannedVolume * 0.5 ? 'concern' : 'warning',
                `Running ${Math.round(gap)}km behind this week's target`,
                { planned: plannedVolume, actual: actualVolume, gap }
            )
            flags.push(observation)
        }
    }

    // 3. Check for fatigue patterns (high HR, low HRV)
    const { data: recentHealth } = await supabase
        .from('health_metrics')
        .select('*')
        .eq('athlete_id', athleteId)
        .gte('date', sevenDaysAgo)
        .order('date', { ascending: false })

    if (recentHealth && recentHealth.length > 3) {
        const avgHrv = recentHealth.reduce((sum, h) => sum + (h.hrv || 0), 0) / recentHealth.length
        const recentHrv = recentHealth[0].hrv || 0

        if (avgHrv > 0 && recentHrv < avgHrv * 0.85) {
            const observation = await createObservation(
                athleteId,
                'hrv_low',
                'concern',
                'HRV is 15% below baseline - consider additional recovery',
                { current: recentHrv, baseline: avgHrv }
            )
            flags.push(observation)
        }

        // Check resting HR elevation
        const avgRestingHr = recentHealth.reduce((sum, h) => sum + (h.resting_hr || 0), 0) / recentHealth.length
        const recentRestingHr = recentHealth[0].resting_hr || 0

        if (avgRestingHr > 0 && recentRestingHr > avgRestingHr * 1.1) {
            const observation = await createObservation(
                athleteId,
                'resting_hr_elevated',
                'warning',
                'Resting HR is elevated - possible fatigue or illness',
                { current: recentRestingHr, baseline: avgRestingHr }
            )
            flags.push(observation)
        }
    }

    // 4. Check for consistency issues (gaps in training)
    const { data: recentActivities } = await supabase
        .from('activities')
        .select('start_time')
        .eq('athlete_id', athleteId)
        .gte('start_time', thirtyDaysAgo)
        .order('start_time', { ascending: true })

    if (recentActivities && recentActivities.length > 1) {
        let maxGap = 0
        for (let i = 1; i < recentActivities.length; i++) {
            const gap = differenceInDays(
                new Date(recentActivities[i].start_time),
                new Date(recentActivities[i - 1].start_time)
            )
            if (gap > maxGap) maxGap = gap
        }

        if (maxGap > 7) {
            const observation = await createObservation(
                athleteId,
                'training_gap',
                maxGap > 14 ? 'concern' : 'warning',
                `${maxGap}-day gap in training detected`,
                { maxGap }
            )
            flags.push(observation)
        }
    }

    // 5. Check for performance trends (pace decline)
    const { data: recentRuns } = await supabase
        .from('activities')
        .select('distance_meters, duration_seconds, start_time')
        .eq('athlete_id', athleteId)
        .gte('start_time', thirtyDaysAgo)
        .gt('distance_meters', 5000) // Only runs > 5km
        .order('start_time', { ascending: false })
        .limit(10)

    if (recentRuns && recentRuns.length >= 5) {
        const paces = recentRuns.map(r => {
            const paceMinPerKm = (r.duration_seconds / 60) / (r.distance_meters / 1000)
            return { pace: paceMinPerKm, date: r.start_time }
        })

        const recentAvg = paces.slice(0, 3).reduce((sum, p) => sum + p.pace, 0) / 3
        const olderAvg = paces.slice(3, 6).reduce((sum, p) => sum + p.pace, 0) / 3

        // If pace is getting slower by more than 5%
        if (recentAvg > olderAvg * 1.05) {
            const observation = await createObservation(
                athleteId,
                'pace_decline',
                'info',
                'Recent pace is slower than usual - check if this is intentional',
                { recentPace: recentAvg.toFixed(2), previousPace: olderAvg.toFixed(2) }
            )
            flags.push(observation)
        }
    }

    return flags
}
