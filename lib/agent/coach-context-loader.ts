/**
 * Coach Context Loader
 *
 * Loads the full training context needed for AI coach conversations.
 * Accepts a server-side Supabase client — never creates its own.
 * Uses Promise.all throughout to minimise latency.
 */

import { SupabaseClient } from '@supabase/supabase-js'
import {
    format,
    startOfWeek,
    endOfWeek,
    addWeeks,
    differenceInWeeks,
    subDays,
    startOfDay,
} from 'date-fns'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CoachAthleteProfile {
    id: string
    name: string | null
    preferred_units: 'metric' | 'imperial'
    vdot: number | null
    training_paces: {
        easy: number      // seconds per km
        marathon: number
        tempo: number
        interval: number
        repetition: number
    } | null
    week_starts_on: number  // 0 = Sunday, 1 = Monday
}

export interface CoachPlanContext {
    id: number
    name: string
    plan_type: string | null
    template_id: string | null
    goal_date: string
    weeks_remaining: number
}

export interface CoachPhaseContext {
    name: string
    description: string | null
    current_week: number
    total_weeks: number
    weekly_volume_target: number | null
    intensity_distribution: Record<string, number> | null
    start_date: string
    end_date: string
}

export interface CoachWorkoutSummary {
    id: number
    date: string
    workout_type: string
    description: string | null
    distance_target_meters: number | null
    duration_target_seconds: number | null
    intensity_target: string | null
    status: string
    completion_status: string
    actual_distance_meters: number | null
}

export interface CoachWeekContext {
    week_start: string
    week_end: string
    volume_target_meters: number | null
    workouts: CoachWorkoutSummary[]
}

export interface CoachPhaseExecution {
    /** Per workout type: how many planned vs completed, and total distances */
    byType: Record<string, {
        planned_count: number
        completed_count: number
        remaining_count: number
        planned_distance_meters: number
        completed_distance_meters: number
    }>
    /** Per week in the phase: planned vs actual volume */
    weeklyVolumes: Array<{
        week_start: string
        planned_meters: number
        actual_meters: number
        workouts_planned: number
        workouts_completed: number
    }>
}

export interface CoachUpcomingWeek {
    week_start: string
    week_end: string
    volume_target_meters: number | null
    workouts: Array<{
        date: string
        workout_type: string
        description: string | null
        distance_target_meters: number | null
        duration_target_seconds: number | null
    }>
}

export interface CoachConstraint {
    constraint_type: string
    description: string | null
}

export interface CoachFeedback {
    workout_type: string | null
    workout_date: string | null
    felt_difficulty: number | null
    fatigue_level: number | null
    injury_concern: boolean
    feedback_text: string | null
}

export interface CoachPersonalRecord {
    seconds: number
    pace_per_km: number
    date: string
}

export interface CoachContext {
    athlete: CoachAthleteProfile
    plan: CoachPlanContext | null
    currentPhase: CoachPhaseContext | null
    thisWeek: CoachWeekContext | null
    phaseExecution: CoachPhaseExecution | null
    upcomingWeeks: CoachUpcomingWeek[]
    constraints: CoachConstraint[]
    recentFeedback: CoachFeedback[]
    personalRecords: Record<string, CoachPersonalRecord>
}

// ---------------------------------------------------------------------------
// Main loader
// ---------------------------------------------------------------------------

export async function loadCoachContext(
    supabase: SupabaseClient,
    athleteId: string
): Promise<CoachContext> {
    const today = new Date()
    const todayStr = format(today, 'yyyy-MM-dd')

    // Round 1: athlete profile + active plan (independent)
    const [athlete, plan] = await Promise.all([
        loadAthleteProfile(supabase, athleteId),
        loadActivePlan(supabase, athleteId, today),
    ])

    // Round 2: everything that depends on plan.id or just needs athleteId + today
    const [currentPhase, thisWeek, upcomingWeeks, constraints, recentFeedback, personalRecords] =
        await Promise.all([
            plan ? loadCurrentPhase(supabase, plan.id, todayStr) : Promise.resolve(null),
            loadThisWeek(supabase, athleteId, today),
            loadUpcomingWeeks(supabase, athleteId, today, 4),
            loadConstraints(supabase, athleteId),
            loadRecentFeedback(supabase, athleteId),
            loadPersonalRecords(supabase, athleteId),
        ])

    // Round 3: phase execution (needs phase start/end dates)
    const phaseExecution = currentPhase
        ? await loadPhaseExecution(supabase, athleteId, currentPhase.start_date, currentPhase.end_date, todayStr)
        : null

    return {
        athlete,
        plan,
        currentPhase,
        thisWeek,
        phaseExecution,
        upcomingWeeks,
        constraints,
        recentFeedback,
        personalRecords,
    }
}

// ---------------------------------------------------------------------------
// Sub-loaders
// ---------------------------------------------------------------------------

async function loadAthleteProfile(supabase: SupabaseClient, athleteId: string): Promise<CoachAthleteProfile> {
    const { data } = await supabase
        .from('athletes')
        .select('id, first_name, last_name, name, preferred_units, vdot, training_paces, week_starts_on')
        .eq('id', athleteId)
        .single()

    const displayName = data?.first_name
        ? [data.first_name, data.last_name].filter(Boolean).join(' ')
        : (data?.name ?? null)

    return {
        id: athleteId,
        name: displayName,
        preferred_units: data?.preferred_units ?? 'metric',
        vdot: data?.vdot ?? null,
        training_paces: data?.training_paces ?? null,
        week_starts_on: data?.week_starts_on ?? 1,
    }
}

async function loadActivePlan(
    supabase: SupabaseClient,
    athleteId: string,
    today: Date
): Promise<CoachPlanContext | null> {
    const { data } = await supabase
        .from('training_plans')
        .select('id, name, plan_type, template_id, end_date')
        .eq('athlete_id', athleteId)
        .eq('status', 'active')
        .single()

    if (!data) return null

    const goalDate = new Date(data.end_date)
    const weeksRemaining = Math.max(0, Math.ceil(differenceInWeeks(goalDate, today)))

    return {
        id: data.id,
        name: data.name,
        plan_type: data.plan_type,
        template_id: data.template_id,
        goal_date: data.end_date,
        weeks_remaining: weeksRemaining,
    }
}

async function loadCurrentPhase(
    supabase: SupabaseClient,
    planId: number,
    todayStr: string
): Promise<CoachPhaseContext | null> {
    const { data } = await supabase
        .from('training_phases')
        .select('phase_name, description, start_date, end_date, weekly_volume_target, intensity_distribution')
        .eq('plan_id', planId)
        .lte('start_date', todayStr)
        .gte('end_date', todayStr)
        .single()

    if (!data) return null

    const phaseStart = new Date(data.start_date)
    const phaseEnd = new Date(data.end_date)
    const currentWeek = differenceInWeeks(new Date(todayStr), phaseStart) + 1
    const totalWeeks = differenceInWeeks(phaseEnd, phaseStart) + 1

    return {
        name: data.phase_name,
        description: data.description,
        current_week: currentWeek,
        total_weeks: totalWeeks,
        weekly_volume_target: data.weekly_volume_target,
        intensity_distribution: data.intensity_distribution,
        start_date: data.start_date,
        end_date: data.end_date,
    }
}

async function loadThisWeek(
    supabase: SupabaseClient,
    athleteId: string,
    today: Date
): Promise<CoachWeekContext | null> {
    const weekStart = format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd')
    const weekEnd = format(endOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd')

    const [{ data: weeklyPlan }, { data: workouts }] = await Promise.all([
        supabase
            .from('weekly_plans')
            .select('weekly_volume_target')
            .eq('athlete_id', athleteId)
            .eq('week_start_date', weekStart)
            .single(),
        supabase
            .from('planned_workouts')
            .select('id, scheduled_date, workout_type, description, distance_target_meters, duration_target_seconds, intensity_target, status, completion_status, completion_metadata')
            .eq('athlete_id', athleteId)
            .gte('scheduled_date', weekStart)
            .lte('scheduled_date', weekEnd)
            .order('scheduled_date', { ascending: true }),
    ])

    if (!workouts) return null

    return {
        week_start: weekStart,
        week_end: weekEnd,
        volume_target_meters: weeklyPlan?.weekly_volume_target ?? null,
        workouts: workouts.map(w => ({
            id: w.id,
            date: w.scheduled_date,
            workout_type: w.workout_type,
            description: w.description,
            distance_target_meters: w.distance_target_meters,
            duration_target_seconds: w.duration_target_seconds,
            intensity_target: w.intensity_target,
            status: w.status,
            completion_status: w.completion_status,
            actual_distance_meters: w.completion_metadata?.actual_distance_meters ?? null,
        })),
    }
}

async function loadPhaseExecution(
    supabase: SupabaseClient,
    athleteId: string,
    phaseStart: string,
    phaseEnd: string,
    todayStr: string
): Promise<CoachPhaseExecution> {
    const { data: workouts } = await supabase
        .from('planned_workouts')
        .select('scheduled_date, workout_type, distance_target_meters, status, completion_status, completion_metadata')
        .eq('athlete_id', athleteId)
        .gte('scheduled_date', phaseStart)
        .lte('scheduled_date', phaseEnd)
        .neq('workout_type', 'rest')
        .order('scheduled_date', { ascending: true })

    if (!workouts) return { byType: {}, weeklyVolumes: [] }

    // Aggregate by workout type
    const byType: CoachPhaseExecution['byType'] = {}
    for (const w of workouts) {
        if (!byType[w.workout_type]) {
            byType[w.workout_type] = {
                planned_count: 0,
                completed_count: 0,
                remaining_count: 0,
                planned_distance_meters: 0,
                completed_distance_meters: 0,
            }
        }
        const entry = byType[w.workout_type]
        entry.planned_count++
        entry.planned_distance_meters += w.distance_target_meters ?? 0

        if (w.completion_status === 'completed' || w.completion_status === 'partial') {
            entry.completed_count++
            entry.completed_distance_meters += w.completion_metadata?.actual_distance_meters ?? w.distance_target_meters ?? 0
        } else if (w.scheduled_date > todayStr) {
            entry.remaining_count++
        }
    }

    // Aggregate by week
    const weekMap = new Map<string, { planned: number; actual: number; wPlanned: number; wCompleted: number }>()
    for (const w of workouts) {
        const date = new Date(w.scheduled_date)
        const weekStart = format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd')
        if (!weekMap.has(weekStart)) {
            weekMap.set(weekStart, { planned: 0, actual: 0, wPlanned: 0, wCompleted: 0 })
        }
        const entry = weekMap.get(weekStart)!
        entry.planned += w.distance_target_meters ?? 0
        entry.wPlanned++
        if (w.completion_status === 'completed' || w.completion_status === 'partial') {
            entry.actual += w.completion_metadata?.actual_distance_meters ?? w.distance_target_meters ?? 0
            entry.wCompleted++
        }
    }

    const weeklyVolumes = Array.from(weekMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([week_start, v]) => ({
            week_start,
            planned_meters: v.planned,
            actual_meters: v.actual,
            workouts_planned: v.wPlanned,
            workouts_completed: v.wCompleted,
        }))

    return { byType, weeklyVolumes }
}

async function loadUpcomingWeeks(
    supabase: SupabaseClient,
    athleteId: string,
    today: Date,
    weeksAhead: number
): Promise<CoachUpcomingWeek[]> {
    // Start from the beginning of next week (today's week is covered by thisWeek)
    const thisWeekEnd = endOfWeek(today, { weekStartsOn: 1 })
    const rangeStart = format(addWeeks(startOfWeek(today, { weekStartsOn: 1 }), 1), 'yyyy-MM-dd')
    const rangeEnd = format(addWeeks(thisWeekEnd, weeksAhead), 'yyyy-MM-dd')

    const [{ data: workouts }, { data: weeklyPlans }] = await Promise.all([
        supabase
            .from('planned_workouts')
            .select('scheduled_date, workout_type, description, distance_target_meters, duration_target_seconds')
            .eq('athlete_id', athleteId)
            .gte('scheduled_date', rangeStart)
            .lte('scheduled_date', rangeEnd)
            .neq('workout_type', 'rest')
            .order('scheduled_date', { ascending: true }),
        supabase
            .from('weekly_plans')
            .select('week_start_date, weekly_volume_target')
            .eq('athlete_id', athleteId)
            .gte('week_start_date', rangeStart)
            .lte('week_start_date', rangeEnd),
    ])

    if (!workouts) return []

    const volumeByWeek = new Map(
        (weeklyPlans ?? []).map(w => [w.week_start_date, w.weekly_volume_target])
    )

    // Group workouts by week
    const weekMap = new Map<string, CoachUpcomingWeek>()
    for (const w of workouts) {
        const date = new Date(w.scheduled_date)
        const weekStart = format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd')
        const weekEnd = format(endOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd')
        if (!weekMap.has(weekStart)) {
            weekMap.set(weekStart, {
                week_start: weekStart,
                week_end: weekEnd,
                volume_target_meters: volumeByWeek.get(weekStart) ?? null,
                workouts: [],
            })
        }
        weekMap.get(weekStart)!.workouts.push({
            date: w.scheduled_date,
            workout_type: w.workout_type,
            description: w.description,
            distance_target_meters: w.distance_target_meters,
            duration_target_seconds: w.duration_target_seconds,
        })
    }

    return Array.from(weekMap.values()).sort((a, b) => a.week_start.localeCompare(b.week_start))
}

async function loadConstraints(supabase: SupabaseClient, athleteId: string): Promise<CoachConstraint[]> {
    const { data } = await supabase
        .from('athlete_constraints')
        .select('constraint_type, description')
        .eq('athlete_id', athleteId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })

    return (data ?? []).map(c => ({
        constraint_type: c.constraint_type,
        description: c.description,
    }))
}

async function loadRecentFeedback(supabase: SupabaseClient, athleteId: string): Promise<CoachFeedback[]> {
    const sevenDaysAgo = format(subDays(new Date(), 7), 'yyyy-MM-dd')

    const { data } = await supabase
        .from('workout_feedback')
        .select(`
            felt_difficulty,
            fatigue_level,
            injury_concern,
            feedback_text,
            planned_workout:planned_workouts(workout_type, scheduled_date)
        `)
        .eq('athlete_id', athleteId)
        .gte('created_at', sevenDaysAgo)
        .order('created_at', { ascending: false })
        .limit(10)

    return (data ?? []).map((f: any) => ({
        workout_type: f.planned_workout?.workout_type ?? null,
        workout_date: f.planned_workout?.scheduled_date ?? null,
        felt_difficulty: f.felt_difficulty,
        fatigue_level: f.fatigue_level,
        injury_concern: f.injury_concern,
        feedback_text: f.feedback_text,
    }))
}

async function loadPersonalRecords(
    supabase: SupabaseClient,
    athleteId: string
): Promise<Record<string, CoachPersonalRecord>> {
    const distances = [
        { meters: 5000, label: '5k' },
        { meters: 10000, label: '10k' },
        { meters: 21097, label: 'half_marathon' },
        { meters: 42195, label: 'marathon' },
    ]

    const results = await Promise.all(
        distances.map(async ({ meters, label }) => {
            const { data } = await supabase
                .from('activities')
                .select('distance_meters, duration_seconds, start_time')
                .eq('athlete_id', athleteId)
                .gte('distance_meters', meters * 0.98)
                .lte('distance_meters', meters * 1.02)
                .order('duration_seconds', { ascending: true })
                .limit(1)
                .single()

            if (!data) return [label, null] as const

            return [label, {
                seconds: data.duration_seconds,
                pace_per_km: data.duration_seconds / (data.distance_meters / 1000),
                date: data.start_time,
            }] as const
        })
    )

    return Object.fromEntries(results.filter(([, v]) => v !== null)) as Record<string, CoachPersonalRecord>
}
