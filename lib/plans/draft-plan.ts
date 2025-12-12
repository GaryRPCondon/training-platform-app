import { supabase, getCurrentAthleteId } from '@/lib/supabase/client'
import type { UserCriteria } from '@/lib/templates/types'

export interface DraftPlanData {
  template_id: string
  template_name: string
  goal_name?: string  // Optional user-provided goal name
  goal_date: string
  goal_type: string
  user_criteria: UserCriteria
}

/**
 * Create draft plan record in database
 */
export async function createDraftPlan(data: DraftPlanData) {
  const athleteId = await getCurrentAthleteId()

  // Check for existing draft and delete it
  const { data: existingDrafts } = await supabase
    .from('training_plans')
    .select('id')
    .eq('athlete_id', athleteId)
    .in('status', ['draft', 'draft_generated'])

  if (existingDrafts && existingDrafts.length > 0) {
    // Delete existing drafts (cascade will handle related records)
    await supabase
      .from('training_plans')
      .delete()
      .in('id', existingDrafts.map(d => d.id))
  }

  // Create goal
  const goalDistances: Record<string, number> = {
    'marathon': 42195,
    'half_marathon': 21097,
    '10k': 10000,
    '5k': 5000
  }

  const { data: goal, error: goalError } = await supabase
    .from('athlete_goals')
    .insert({
      athlete_id: athleteId,
      goal_type: 'race',
      goal_name: data.goal_name || `${data.goal_type.replace('_', ' ')} - ${data.template_name}`,
      target_date: data.goal_date,
      target_value: {
        distance_meters: goalDistances[data.goal_type]
      },
      status: 'active',
      priority: 1
    })
    .select()
    .single()

  if (goalError) throw goalError

  // Calculate plan start date (today or next Monday)
  const today = new Date()
  const dayOfWeek = today.getDay()
  const daysUntilMonday = dayOfWeek === 0 ? 1 : dayOfWeek === 1 ? 0 : 8 - dayOfWeek
  const planStart = new Date(today)
  planStart.setDate(today.getDate() + daysUntilMonday)

  // Create training plan (draft status)
  const { data: plan, error: planError } = await supabase
    .from('training_plans')
    .insert({
      athlete_id: athleteId,
      goal_id: goal.id,
      name: data.goal_name || `${data.template_name} - Draft`,
      start_date: planStart.toISOString().split('T')[0],
      end_date: data.goal_date,
      plan_type: data.goal_type,
      status: 'draft',
      created_by: 'agent',
      template_id: data.template_id,
      template_version: '1.0',
      user_criteria: data.user_criteria
    })
    .select()
    .single()

  if (planError) throw planError

  return { goal, plan }
}

/**
 * Get draft plan by ID
 */
export async function getDraftPlan(planId: number) {
  const { data, error } = await supabase
    .from('training_plans')
    .select(`
      *,
      athlete_goals (*),
      training_phases (*),
      weekly_plans (
        *,
        planned_workouts (*)
      )
    `)
    .eq('id', planId)
    .single()

  if (error) throw error
  return data
}

/**
 * Update plan status
 */
export async function updatePlanStatus(planId: number, status: string) {
  const { error } = await supabase
    .from('training_plans')
    .update({ status })
    .eq('id', planId)

  if (error) throw error
}
