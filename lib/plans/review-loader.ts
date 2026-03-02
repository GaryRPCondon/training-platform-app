import { createClient } from '@/lib/supabase/client'
import type { PlanReviewContext, WeekViewData, WorkoutWithDetails } from '@/types/review'
import { parseISO, format, endOfWeek } from 'date-fns'

// Distance ranges for validation — keep in sync with workout-validator.ts
// Note: for intervals/tempo, distance_target_meters is the work segment only (warmup/cooldown added server-side)
const DISTANCE_RANGES: Record<string, { min: number; max: number }> = {
  intervals: { min: 3000, max: 25000 },
  tempo: { min: 5000, max: 35000 },
  easy_run: { min: 3000, max: 25000 },
  long_run: { min: 10000, max: 50000 },
  recovery: { min: 3000, max: 12000 },
  cross_training: { min: 0, max: 0 },
  rest: { min: 0, max: 0 },
  race: { min: 5000, max: 100000 }
}

function validateWorkout(workout: any): WorkoutWithDetails['validation_warning'] {
  // Skip workouts without distance
  if (!workout.distance_target_meters || workout.distance_target_meters === 0) {
    return undefined
  }

  const workoutType = workout.workout_type?.toLowerCase()
  const range = DISTANCE_RANGES[workoutType]

  // Skip if no range defined or validation not needed
  if (!range || (range.min === 0 && range.max === 0)) {
    return undefined
  }

  // Check if distance is outside expected range
  const actualDistance = workout.distance_target_meters
  if (actualDistance < range.min || actualDistance > range.max) {
    return {
      message: `Possible LLM hallucination: Distance is ${(actualDistance / 1000).toFixed(1)}km, but expected ${(range.min / 1000).toFixed(1)}-${(range.max / 1000).toFixed(1)}km for ${workout.workout_type}`,
      expectedRange: range,
      actualDistance
    }
  }

  return undefined
}

export async function loadPlanForReview(planId: number): Promise<PlanReviewContext> {
  const supabase = createClient()

  // Get athlete ID from authenticated session
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const athleteId = user.id

  // Load plan with all related data
  const { data: plan, error: planError } = await supabase
    .from('training_plans')
    .select(`
      id,
      name,
      goal_id,
      start_date,
      end_date,
      plan_type,
      status,
      template_id,
      template_version,
      vdot,
      training_paces,
      pace_source,
      created_at,
      athlete_goals (
        goal_name,
        goal_type,
        target_date
      ),
      training_phases (
        id,
        phase_name,
        phase_order,
        start_date,
        end_date
      )
    `)
    .eq('id', planId)
    .eq('athlete_id', athleteId)
    .single()

  if (planError) throw new Error(`Failed to load plan: ${planError.message}`)
  if (!plan) throw new Error('Plan not found')

  // Load all weekly plans with workouts
  const { data: weeklyPlans, error: weeksError } = await supabase
    .from('weekly_plans')
    .select(`
      id,
      week_start_date,
      week_number,
      weekly_volume_target,
      phase_id,
      planned_workouts (
        id,
        scheduled_date,
        scheduled_time,
        workout_type,
        description,
        distance_target_meters,
        duration_target_seconds,
        intensity_target,
        structured_workout,
        workout_index,
        status
      )
    `)
    .eq('athlete_id', athleteId)
    .in('phase_id', (plan.training_phases as any[]).map(p => p.id))
    .order('week_start_date', { ascending: true })

  if (weeksError) throw new Error(`Failed to load weeks: ${weeksError.message}`)

  // Process weeks into structured format
  const weeks: WeekViewData[] = (weeklyPlans || []).map(week => {
    const phase = (plan.training_phases as any[]).find(p => p.id === week.phase_id)

    const workoutsWithDetails: WorkoutWithDetails[] = ((week.planned_workouts as any[]) || []).map(workout => ({
      ...workout,
      date: parseISO(workout.scheduled_date),
      formatted_date: format(parseISO(workout.scheduled_date), 'EEE, MMM d'),
      phase_name: phase?.phase_name || 'unknown',
      week_of_plan: week.week_number || 0,
      validation_warning: validateWorkout(workout)
    }))

    return {
      week_number: week.week_number || 0,
      week_start: parseISO(week.week_start_date),
      week_end: endOfWeek(parseISO(week.week_start_date)),
      phase: phase?.phase_name || 'unknown',
      workouts: workoutsWithDetails,
      weekly_volume: week.weekly_volume_target || 0,
      weekly_plan_id: week.id
    }
  })

  // Calculate total weeks
  const totalWeeks = weeks.length

  // Determine current week (for future: track progress)
  const currentWeek = 1  // For now, always start at week 1 during review

  // Get goal info from athlete_goals relation
  const goalData = (plan.athlete_goals as any) || {}

  return {
    plan_id: plan.id,
    plan_name: goalData.goal_name || plan.name || 'Training Plan',
    goal_date: goalData.target_date || plan.end_date,
    goal_type: goalData.goal_type || plan.plan_type || 'unknown',
    template_name: plan.template_id || 'Custom',
    status: plan.status,
    total_weeks: totalWeeks,
    current_week: currentWeek,
    vdot: plan.vdot || null,
    training_paces: plan.training_paces || null,
    phases: (plan.training_phases as any[]).sort((a, b) => a.phase_order - b.phase_order),
    weeks: weeks
  }
}

export function getWeekByNumber(context: PlanReviewContext, weekNumber: number): WeekViewData | undefined {
  return context.weeks.find(w => w.week_number === weekNumber)
}

export function getWorkoutByIndex(context: PlanReviewContext, workoutIndex: string): WorkoutWithDetails | undefined {
  // Validate format (should be W#:D#)
  if (!/^W\d+:D\d+$/.test(workoutIndex)) {
    return undefined
  }

  for (const week of context.weeks) {
    const workout = week.workouts.find(w => w.workout_index === workoutIndex)
    if (workout) return workout
  }
  return undefined
}
