import type { ParsedPlan } from './response-parser'
import { calculateWorkoutDate } from './response-parser'
import { resolvePace, type PaceTarget } from './pace-resolver'
import { addDays, format, parseISO } from 'date-fns'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AllTrainingPaces } from '@/lib/training/vdot'


export interface PlanWriteOptions {
  planId: number
  planStartDate: string      // YYYY-MM-DD - When Week 1 starts (e.g., next Monday)
  userStartDate?: string      // YYYY-MM-DD - User's selected start date (may be before planStartDate)
  goalDate: string           // YYYY-MM-DD
  supabase: SupabaseClient   // Supabase client to use (server or client)
  paceTargets?: Record<string, PaceTarget>   // Template methodology pace targets
  athletePaces?: AllTrainingPaces | null      // Athlete's training + race paces
}

/**
 * Stamp resolved pace targets onto a structured_workout object.
 * Adds target_pace_sec_per_km, pace_label, pace_description, pace_source if resolvable.
 */
function stampResolvedPace(
  structuredWorkout: Record<string, unknown>,
  intensityTarget: string | undefined,
  paceTargets: Record<string, PaceTarget> | undefined,
  athletePaces: AllTrainingPaces | null | undefined
): Record<string, unknown> {
  if (!paceTargets || !athletePaces || !intensityTarget) return structuredWorkout

  const resolved = resolvePace(intensityTarget, paceTargets, athletePaces)
  if (!resolved) return structuredWorkout

  return {
    ...structuredWorkout,
    target_pace_sec_per_km: resolved.target_pace_sec_per_km,
    target_pace_upper_sec_per_km: resolved.target_pace_upper_sec_per_km,
    pace_label: resolved.pace_label,
    pace_description: resolved.pace_description,
    pace_source: resolved.pace_source,
  }
}

/**
 * Write parsed plan to database
 */
export async function writePlanToDatabase(
  parsedPlan: ParsedPlan,
  options: PlanWriteOptions
) {
  const { planId, planStartDate, userStartDate, supabase, paceTargets, athletePaces } = options

  // Get athlete_id from plan
  const { data: planData } = await supabase
    .from('training_plans')
    .select('athlete_id')
    .eq('id', planId)
    .single()

  if (!planData) throw new Error('Plan not found')
  const athleteId = planData.athlete_id

  // Calculate week start dates using date-fns to avoid timezone issues
  const planStart = new Date(planStartDate)
  const weekStartDates = parsedPlan.weeks.map(week => {
    // Use addDays to add weeks worth of days (week 1 = planStart + 0 days, week 2 = planStart + 7 days, etc.)
    const weekStart = addDays(planStart, (week.week_number - 1) * 7)
    return {
      week_number: week.week_number,
      date: format(weekStart, 'yyyy-MM-dd')
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
    const endDateWeekStart = weekStartDates.find(w => w.week_number === phase.end)?.date
    // end_date should be the last day of the phase's final week (start + 6 days)
    const endDate = endDateWeekStart
      ? format(addDays(parseISO(endDateWeekStart), 6), 'yyyy-MM-dd')
      : undefined

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

  // Handle pre-week workouts if present (for partial weeks before structured training)
  let preWeekWorkoutCount = 0
  if (parsedPlan.preWeekWorkouts && parsedPlan.preWeekWorkouts.length > 0 && userStartDate) {
    const userStart = new Date(userStartDate)
    const preWeekVolume = parsedPlan.preWeekWorkouts.reduce((sum, w) =>
      sum + (w.distance_km || 0), 0)

    // Create weekly_plans record for Week 0 (pre-week)
    const { data: preWeekPlan, error: preWeekError } = await supabase
      .from('weekly_plans')
      .insert({
        athlete_id: athleteId,
        phase_id: phaseRecords[0]?.id || null,  // Attach to first phase
        week_start_date: userStartDate,
        week_number: 0,  // Special: pre-week
        weekly_volume_target: preWeekVolume * 1000,  // Convert km to meters
        status: 'planned'
      })
      .select()
      .single()

    if (preWeekError) throw preWeekError

    // Write each pre-week workout
    for (let i = 0; i < parsedPlan.preWeekWorkouts.length; i++) {
      const workout = parsedPlan.preWeekWorkouts[i]
      const workoutDate = format(addDays(userStart, i), 'yyyy-MM-dd')

      const { error: workoutError } = await supabase
        .from('planned_workouts')
        .insert({
          weekly_plan_id: preWeekPlan.id,
          athlete_id: athleteId,
          scheduled_date: workoutDate,
          workout_index: `W0:D${i + 1}`,
          workout_type: workout.type,
          description: workout.description || 'Easy ramp-in run',
          distance_target_meters: workout.distance_km ? workout.distance_km * 1000 : null,
          duration_target_seconds: null,
          intensity_target: workout.intensity || 'easy',
          structured_workout: stampResolvedPace(
            workout.structured_workout ?? { pace_guidance: workout.pace_guidance, notes: workout.notes },
            workout.intensity,
            paceTargets,
            athletePaces
          ),
          status: 'scheduled'
        })

      if (workoutError) throw workoutError
      preWeekWorkoutCount++
    }
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
          duration_target_seconds: workout.duration_seconds ?? null,
          intensity_target: workout.intensity,
          structured_workout: stampResolvedPace(
            workout.structured_workout ?? { pace_guidance: workout.pace_guidance, notes: workout.notes },
            workout.intensity,
            paceTargets,
            athletePaces
          ),
          status: 'scheduled'
        })

      if (workoutError) throw workoutError
    }
  }

  const regularWorkouts = parsedPlan.weeks.reduce((sum, w) => sum + w.workouts.length, 0)
  return {
    phases: phaseRecords.length,
    weeks: parsedPlan.weeks.length + (preWeekWorkoutCount > 0 ? 1 : 0),  // Include pre-week if present
    workouts: regularWorkouts + preWeekWorkoutCount
  }
}

/**
 * Delete all weekly plans and workouts for a plan (for regeneration)
 * FIXED: Now correctly deletes only weekly plans for THIS plan's phases
 */
export async function clearPlanWorkouts(planId: number, supabase: SupabaseClient) {
  // Get all phases for this plan
  const { data: phases, error: phasesError } = await supabase
    .from('training_phases')
    .select('id')
    .eq('plan_id', planId)

  if (phasesError) throw phasesError
  if (!phases || phases.length === 0) {
    // No phases = no workouts to delete, just return
    return
  }

  const phaseIds = phases.map(p => p.id)

  // Delete weekly plans for these phases (cascade will delete workouts)
  const { error: weeklyPlansError } = await supabase
    .from('weekly_plans')
    .delete()
    .in('phase_id', phaseIds)

  if (weeklyPlansError) throw weeklyPlansError

  // Delete the phases themselves
  const { error: phasesDeleteError } = await supabase
    .from('training_phases')
    .delete()
    .eq('plan_id', planId)

  if (phasesDeleteError) throw phasesDeleteError
}
