import { addWeeks, addDays, startOfWeek, format } from 'date-fns'
import { calculatePhaseWeeks, calculateWeeklyVolume, PHASE_CONFIGS } from './periodization'
import { getWorkoutTemplatesForPhase, calculateWorkoutDistance } from './workout-templates'

export interface PlanGenerationParams {
    athleteId: string
    goalDate: Date
    goalType: 'marathon' | 'half_marathon' | '10k' | '5k'
    currentWeeklyVolume: number
    maxWeeklyVolume: number
    preferredLongRunDay: number // 0-6 (Sunday-Saturday)
}

export interface GeneratedPlan {
    goal: {
        athlete_id: string
        goal_type: string
        target_date: string
        target_distance_meters: number
        target_time_seconds: number | null
        notes: string | null
    }
    plan: {
        athlete_id: string
        goal_id?: number
        goal_date: string
        start_date: string
        end_date: string
        plan_type: string
        name: string
        status: 'draft' | 'active'
    }
    phases: Array<{
        phase_name: string
        phase_order: number
        start_date: string
        end_date: string
        weekly_volume_target: number
        max_weekly_volume: number
        description: string
    }>
    weeklyPlans: Array<{
        phase_id?: number
        week_start_date: string
        week_number: number
        weekly_volume_target: number
        status: 'planned'
    }>
    workouts: Array<{
        weekly_plan_id?: number
        scheduled_date: string
        workout_type: string
        description: string
        distance_target_meters: number | null
        intensity_target: string
        structured_workout: any | null
        status: 'scheduled'
    }>
}

export async function generateTrainingPlan(params: PlanGenerationParams): Promise<GeneratedPlan> {
    const startDate = startOfWeek(new Date(), { weekStartsOn: 1 }) // Monday
    const weeksToGoal = Math.ceil(
        (params.goalDate.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)
    )

    // Calculate phase distribution
    const phaseWeeks = calculatePhaseWeeks(weeksToGoal)

    // Create plan header
    const plan = {
        athlete_id: params.athleteId,
        goal_date: params.goalDate.toISOString(),
        start_date: startDate.toISOString(),
        end_date: params.goalDate.toISOString(),
        plan_type: params.goalType,
        name: `${params.goalType.replace('_', ' ')} Training Plan`,
        status: 'draft' as const
    }

    // Generate phases
    const phases = []
    let currentDate = new Date(startDate)
    let weekCounter = 0

    for (let i = 0; i < phaseWeeks.length; i++) {
        const phaseConfig = PHASE_CONFIGS[i]
        const phaseWeekCount = phaseWeeks[i].weeks
        const phaseEndDate = addWeeks(currentDate, phaseWeekCount)

        phases.push({
            phase_name: phaseConfig.name,
            phase_order: i + 1,
            start_date: currentDate.toISOString(),
            end_date: phaseEndDate.toISOString(),
            weekly_volume_target: Math.round(params.maxWeeklyVolume * phaseConfig.volumeMultiplier),
            max_weekly_volume: params.maxWeeklyVolume,
            description: phaseConfig.description
        })

        currentDate = phaseEndDate
    }

    // Generate weekly plans and workouts
    const weeklyPlans = []
    const workouts = []
    currentDate = new Date(startDate)
    weekCounter = 0

    for (let phaseIndex = 0; phaseIndex < phases.length; phaseIndex++) {
        const phase = phases[phaseIndex]
        const phaseConfig = PHASE_CONFIGS[phaseIndex]
        const phaseWeekCount = phaseWeeks[phaseIndex].weeks

        for (let weekInPhase = 1; weekInPhase <= phaseWeekCount; weekInPhase++) {
            weekCounter++

            // Calculate weekly volume with progression and recovery weeks
            const weeklyVolume = calculateWeeklyVolume(
                weekInPhase,
                phaseWeekCount,
                phaseConfig.volumeMultiplier,
                params.maxWeeklyVolume,
                params.currentWeeklyVolume
            )

            const weeklyPlan = {
                week_start_date: format(currentDate, 'yyyy-MM-dd'),
                week_number: weekCounter,
                weekly_volume_target: Math.round(weeklyVolume),
                status: 'planned' as const
            }
            weeklyPlans.push(weeklyPlan)

            // Generate workouts for this week
            const templates = getWorkoutTemplatesForPhase(phase.phase_name)

            for (let dayIndex = 0; dayIndex < templates.length; dayIndex++) {
                const template = templates[dayIndex]
                const workoutDate = addDays(currentDate, dayIndex)

                workouts.push({
                    scheduled_date: format(workoutDate, 'yyyy-MM-dd'),
                    workout_type: template.type,
                    description: template.description,
                    distance_target_meters: template.distancePercentage > 0
                        ? calculateWorkoutDistance(template, weeklyVolume)
                        : null,
                    intensity_target: template.intensity,
                    structured_workout: template.structuredWorkout || null,
                    status: 'scheduled' as const
                })
            }

            currentDate = addWeeks(currentDate, 1)
        }
    }

    // Create goal record
    const goalDistances: Record<string, number> = {
        'marathon': 42195,
        'half_marathon': 21097,
        '10k': 10000,
        '5k': 5000
    }

    const goal = {
        athlete_id: params.athleteId,
        goal_type: params.goalType,
        target_date: params.goalDate.toISOString(),
        target_distance_meters: goalDistances[params.goalType],
        target_time_seconds: null,
        notes: null
    }

    return {
        goal,
        plan,
        phases,
        weeklyPlans,
        workouts
    }
}
