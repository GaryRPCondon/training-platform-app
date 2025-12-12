import { supabase } from '@/lib/supabase/client'
import type { ParsedPlan } from './response-parser'
import { calculateWorkoutDate } from './response-parser'

export interface PlanWriteOptions {
  planId: number
  planStartDate: string  // YYYY-MM-DD
  goalDate: string       // YYYY-MM-DD
}

/**
 * Write parsed plan to database
 */
export async function writePlanToDatabase(
  parsedPlan: ParsedPlan,
  options: PlanWriteOptions
) {
  const { planId, planStartDate } = options

  // Get athlete_id from plan
  const { data: planData } = await supabase
    .from('training_plans')
    .select('athlete_id')
    .eq('id', planId)
    .single()

  if (!planData) throw new Error('Plan not found')
  const athleteId = planData.athlete_id

  // Calculate week start dates
  const planStart = new Date(planStartDate)
  const weekStartDates = parsedPlan.weeks.map(week => {
    const weekStart = new Date(planStart)
    weekStart.setDate(weekStart.getDate() + ((week.week_number - 1) * 7))
    return {
      week_number: week.week_number,
      date: weekStart.toISOString().split('T')[0]
    }
  })

  // Create phases (one phase per traditional period)
  const totalWeeks = parsedPlan.weeks.length
  const phases = [
    { name: 'base', start: 1, end: Math.ceil(totalWeeks * 0.25) },
    { name: 'build', start: Math.ceil(totalWeeks * 0.25) + 1, end: Math.ceil(totalWeeks * 0.70) },
    { name: 'peak', start: Math.ceil(totalWeeks * 0.70) + 1, end: Math.ceil(totalWeeks * 0.85) },
    { name: 'taper', start: Math.ceil(totalWeeks * 0.85) + 1, end: totalWeeks }
  ]

  // Insert phases
  const phaseRecords = []
  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i]
    const startDate = weekStartDates.find(w => w.week_number === phase.start)?.date
    const endDate = weekStartDates.find(w => w.week_number === phase.end)?.date

    if (!startDate || !endDate) continue

    const { data: phaseRecord, error: phaseError } = await supabase
      .from('training_phases')
      .insert({
        plan_id: planId,
        phase_name: phase.name,
        phase_order: i + 1,
        start_date: startDate,
        end_date: endDate,
        description: `${phase.name.charAt(0).toUpperCase() + phase.name.slice(1)} phase`
      })
      .select()
      .single()

    if (phaseError) throw phaseError
    phaseRecords.push({ ...phaseRecord, startWeek: phase.start, endWeek: phase.end })
  }

  // Insert weekly plans and workouts
  for (const week of parsedPlan.weeks) {
    const weekStartDate = weekStartDates.find(w => w.week_number === week.week_number)?.date
    if (!weekStartDate) {
      throw new Error(`Could not find start date for week ${week.week_number}`)
    }

    // Find phase for this week
    const phase = phaseRecords.find(p =>
      week.week_number >= p.startWeek && week.week_number <= p.endWeek
    )

    // Insert weekly plan
    const { data: weeklyPlan, error: weekError } = await supabase
      .from('weekly_plans')
      .insert({
        phase_id: phase?.id || null,
        athlete_id: athleteId,
        week_start_date: weekStartDate,
        week_number: week.week_number,
        weekly_volume_target: week.weekly_total_km * 1000, // Convert to meters
        status: 'planned'
      })
      .select()
      .single()

    if (weekError) throw weekError

    // Insert workouts for this week
    for (const workout of week.workouts) {
      const workoutDate = calculateWorkoutDate(new Date(weekStartDate), workout.day)

      const { error: workoutError } = await supabase
        .from('planned_workouts')
        .insert({
          weekly_plan_id: weeklyPlan.id,
          athlete_id: weeklyPlan.athlete_id,
          scheduled_date: workoutDate,
          workout_type: workout.type,
          workout_index: workout.workout_index,
          description: workout.description,
          distance_target_meters: workout.distance_meters,
          duration_target_seconds: workout.duration_minutes ? workout.duration_minutes * 60 : null,
          intensity_target: workout.intensity,
          structured_workout: {
            pace_guidance: workout.pace_guidance,
            notes: workout.notes
          },
          status: 'scheduled'
        })

      if (workoutError) throw workoutError
    }
  }

  return {
    phases: phaseRecords.length,
    weeks: parsedPlan.weeks.length,
    workouts: parsedPlan.weeks.reduce((sum, w) => sum + w.workouts.length, 0)
  }
}

/**
 * Delete all weekly plans and workouts for a plan (for regeneration)
 */
export async function clearPlanWorkouts(planId: number) {
  // Get athlete_id first
  const { data: plan } = await supabase
    .from('training_plans')
    .select('athlete_id')
    .eq('id', planId)
    .single()

  if (!plan) throw new Error('Plan not found')

  // Delete weekly plans (cascade will delete workouts)
  const { data: weeklyPlans } = await supabase
    .from('weekly_plans')
    .select('id')
    .eq('athlete_id', plan.athlete_id)

  if (weeklyPlans) {
    await supabase
      .from('weekly_plans')
      .delete()
      .in('id', weeklyPlans.map(w => w.id))
  }

  // Delete phases
  await supabase
    .from('training_phases')
    .delete()
    .eq('plan_id', planId)
}
