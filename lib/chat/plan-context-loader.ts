/**
 * Plan Context Loader for Phase 5 Chat Refinement
 *
 * Loads complete plan structure with all relationships for LLM context.
 * This allows the LLM to understand the current plan state before making modifications.
 */

import { createClient as createServerClient } from '@/lib/supabase/server'
import { loadFullTemplate } from '@/lib/templates/template-loader'
import type { FullTemplate } from '@/lib/templates/types'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Complete plan context for LLM regeneration
 */
export interface FullPlanContext {
  plan: {
    id: number
    name: string
    end_date: string
    start_date: string
    plan_type: string
    vdot: number | null
    training_paces: any
    template_id: string
    user_criteria: any
    status: string
  }
  template: FullTemplate
  phases: Array<{
    phase_name: string
    phase_order: number
    start_date: string
    end_date: string
  }>
  weeks: Array<{
    week_number: number
    week_start_date: string
    phase_name: string
    weekly_volume_km: number
    workouts: Array<{
      workout_index: string
      day: number
      scheduled_date: string
      workout_type: string
      description: string
      distance_km: number | null
      intensity_target: string
      pace_guidance: string | null
      status: string
    }>
  }>
  athlete_constraints: {
    preferred_rest_days: number[]
    comfortable_peak_mileage: number
    current_weekly_mileage: number
    days_per_week: number
    week_starts_on: number // 0=Sunday, 1=Monday, etc.
  }
}

/**
 * Load complete plan context with all relationships
 *
 * @param planId - ID of the training plan to load
 * @param supabaseClient - Optional authenticated Supabase client (for server-side calls)
 * @returns Complete plan context for LLM
 * @throws Error if plan not found or user not authenticated
 */
export async function loadFullPlanContext(
  planId: number,
  supabaseClient?: SupabaseClient
): Promise<FullPlanContext> {
  const supabase = supabaseClient || await createServerClient()

  // Get current user
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    throw new Error('Not authenticated')
  }

  const athleteId = user.id

  // Load plan with all nested relationships
  const { data: plan, error: planError } = await supabase
    .from('training_plans')
    .select(`
      id,
      name,
      end_date,
      start_date,
      plan_type,
      vdot,
      training_paces,
      pace_source,
      pace_source_data,
      template_id,
      template_version,
      user_criteria,
      status,
      training_phases (
        id,
        phase_name,
        phase_order,
        start_date,
        end_date,
        weekly_plans (
          id,
          week_number,
          week_start_date,
          weekly_volume_target,
          planned_workouts (
            id,
            workout_index,
            scheduled_date,
            workout_type,
            description,
            distance_target_meters,
            intensity_target,
            structured_workout,
            status
          )
        )
      )
    `)
    .eq('id', planId)
    .eq('athlete_id', athleteId)
    .single()

  if (planError) {
    throw new Error(`Failed to load plan: ${planError.message}`)
  }

  if (!plan) {
    throw new Error('Plan not found')
  }

  // Load athlete data for week_starts_on
  const { data: athlete } = await supabase
    .from('athletes')
    .select('week_starts_on')
    .eq('id', athleteId)
    .single()

  // Load original template
  const template = await loadFullTemplate(plan.template_id)

  // Flatten phases structure
  const phases = (plan.training_phases as any[]).map(p => ({
    phase_name: p.phase_name,
    phase_order: p.phase_order,
    start_date: p.start_date,
    end_date: p.end_date
  }))

  // Flatten weeks structure with workouts
  const weeks = (plan.training_phases as any[])
    .flatMap(phase =>
      (phase.weekly_plans as any[]).map(week => ({
        week_number: week.week_number,
        week_start_date: week.week_start_date,
        phase_name: phase.phase_name,
        weekly_volume_km: week.weekly_volume_target ? week.weekly_volume_target / 1000 : 0,
        workouts: (week.planned_workouts as any[]).map(w => ({
          workout_index: w.workout_index,
          day: getDayNumber(w.scheduled_date, week.week_start_date),
          scheduled_date: w.scheduled_date,
          workout_type: w.workout_type,
          description: w.description || '',
          distance_km: w.distance_target_meters ? w.distance_target_meters / 1000 : null,
          intensity_target: w.intensity_target || '',
          pace_guidance: w.structured_workout?.pace_guidance || null,
          status: w.status
        }))
      }))
    )
    .sort((a, b) => a.week_number - b.week_number)

  // Extract athlete constraints from user_criteria
  const criteria = plan.user_criteria || {}

  return {
    plan: {
      id: plan.id,
      name: plan.name,
      end_date: plan.end_date,
      start_date: plan.start_date,
      plan_type: plan.plan_type,
      vdot: plan.vdot,
      training_paces: plan.training_paces,
      template_id: plan.template_id,
      user_criteria: plan.user_criteria,
      status: plan.status
    },
    template,
    phases,
    weeks,
    athlete_constraints: {
      preferred_rest_days: criteria.preferred_rest_days || [],
      comfortable_peak_mileage: criteria.comfortable_peak_mileage || 80,
      current_weekly_mileage: criteria.current_weekly_mileage || 30,
      days_per_week: criteria.days_per_week || 5,
      week_starts_on: athlete?.week_starts_on ?? 0 // 0=Sunday (default)
    }
  }
}

/**
 * Calculate day number within week (1-7) from workout date and week start
 *
 * @param workoutDate - Scheduled date of workout (YYYY-MM-DD)
 * @param weekStart - Start date of week (YYYY-MM-DD)
 * @returns Day number (1 = first day of week, 7 = last day)
 */
function getDayNumber(workoutDate: string, weekStart: string): number {
  const workoutTime = new Date(workoutDate).getTime()
  const weekStartTime = new Date(weekStart).getTime()
  const diffDays = Math.floor((workoutTime - weekStartTime) / (1000 * 60 * 60 * 24))
  return diffDays + 1 // 1-indexed (day 1 = week start)
}

/**
 * Format plan context as readable text for LLM prompt
 *
 * This creates a human-readable representation of the plan that the LLM
 * can easily understand and reference when making modifications.
 *
 * @param context - Full plan context
 * @returns Formatted text representation (~2500 tokens for 18-week plan)
 */
export function formatContextForLLM(context: FullPlanContext): string {
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  let formatted = `# Current Training Plan\n\n`

  // Plan overview
  formatted += `**Plan**: ${context.plan.name}\n`
  formatted += `**End Date**: ${context.plan.end_date}\n`
  formatted += `**Plan Type**: ${context.plan.plan_type || 'marathon'}\n`
  formatted += `**Total Weeks**: ${context.weeks.length}\n`
  formatted += `**Status**: ${context.plan.status}\n`
  if (context.plan.vdot) {
    formatted += `**VDOT**: ${context.plan.vdot}\n`
  }
  formatted += `\n`

  // Phase structure
  formatted += `## Phase Structure\n\n`
  for (const phase of context.phases) {
    const weekCount = context.weeks.filter(w => w.phase_name === phase.phase_name).length
    formatted += `- **${phase.phase_name}**: ${weekCount} weeks (${phase.start_date} to ${phase.end_date})\n`
  }
  formatted += `\n`

  // Athlete constraints
  formatted += `## Athlete Constraints\n\n`
  if (context.athlete_constraints.preferred_rest_days.length > 0) {
    const restDays = context.athlete_constraints.preferred_rest_days.map(d => dayNames[d]).join(', ')
    formatted += `- **Required Rest Days**: ${restDays}\n`
  }
  formatted += `- **Comfortable Peak Mileage**: ${context.athlete_constraints.comfortable_peak_mileage}km/week\n`
  formatted += `- **Training Days per Week**: ${context.athlete_constraints.days_per_week}\n`
  formatted += `\n`

  // All workouts (condensed format)
  formatted += `## Current Plan Structure (All Workouts)\n\n`
  for (const week of context.weeks) {
    formatted += `### Week ${week.week_number} - ${week.phase_name} (${week.weekly_volume_km.toFixed(1)}km)\n\n`

    for (const workout of week.workouts) {
      formatted += `- **${workout.workout_index}** (Day ${workout.day}): `
      formatted += `${workout.workout_type} `

      if (workout.distance_km) {
        formatted += `${workout.distance_km.toFixed(1)}km `
      }

      formatted += `[${workout.intensity_target}]`

      if (workout.description && workout.description !== workout.workout_type) {
        formatted += ` - ${workout.description}`
      }

      if (workout.status !== 'scheduled') {
        formatted += ` (${workout.status})`
      }

      formatted += `\n`
    }
    formatted += `\n`
  }

  return formatted
}

/**
 * Get summary statistics from plan context
 *
 * Useful for validation and logging
 */
export function getPlanSummary(context: FullPlanContext): {
  totalWeeks: number
  totalWorkouts: number
  totalVolume: number
  phaseBreakdown: Record<string, number>
} {
  const totalWorkouts = context.weeks.reduce((sum, week) => sum + week.workouts.length, 0)
  const totalVolume = context.weeks.reduce((sum, week) => sum + week.weekly_volume_km, 0)

  const phaseBreakdown: Record<string, number> = {}
  for (const week of context.weeks) {
    phaseBreakdown[week.phase_name] = (phaseBreakdown[week.phase_name] || 0) + 1
  }

  return {
    totalWeeks: context.weeks.length,
    totalWorkouts,
    totalVolume: Math.round(totalVolume),
    phaseBreakdown
  }
}
