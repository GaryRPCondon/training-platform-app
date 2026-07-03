import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { withRateLimit } from '@/lib/rate-limit/with-rate-limit'
import { demoProviderOverride } from '@/lib/demo/demo'
import { loadFullTemplate, getTemplateSummary } from '@/lib/templates/template-loader'
import { buildGenerationSystemPrompt, buildGenerationUserMessage } from '@/lib/plans/llm-prompts'
import { generatePlan, ActivePlanExistsError } from '@/lib/plans/plan-generation-engine'
import { calculateTrainingPaces, calculateRacePaces, RACE_DISTANCES } from '@/lib/training/vdot'
import type { UserCriteria } from '@/lib/templates/types'
import type { TrainingPaces } from '@/types/database'
import { computeWeeksAvailable } from '@/lib/utils/plan-dates'
import { z } from 'zod'

const generateSchema = z.object({
  template_id: z.string().min(1),
  goal_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  goal_type: z.string().min(1),
  goal_name: z.string().max(200).optional(),
  user_criteria: z.record(z.string(), z.unknown()),
  first_day_of_week: z.number().int().min(0).max(6).optional(),
  vdot_data: z.object({
    vdot: z.number(),
    source: z.string().optional(),
    sourceData: z.record(z.string(), z.unknown()).optional(),
  }).nullable().optional(),
  replace_active: z.boolean().optional(),
})

async function postHandler(request: Request) {
  try {
    const body = await request.json()
    const parsed = generateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
    }
    const { template_id, goal_date, start_date, goal_type, goal_name, user_criteria, first_day_of_week, vdot_data, replace_active } = parsed.data

    // Calculate training paces if VDOT data provided
    let vdot: number | null = null
    let trainingPaces: TrainingPaces | null = null
    let paceSource: string | null = null
    let paceSourceData: Record<string, unknown> | null = null

    if (vdot_data && typeof vdot_data === 'object' && typeof vdot_data.vdot === 'number') {
      const vdotValue = vdot_data.vdot
      vdot = vdotValue
      trainingPaces = { ...calculateTrainingPaces(vdotValue), ...calculateRacePaces(vdotValue) }
      paceSource = vdot_data.source || 'vdot_direct'
      paceSourceData = vdot_data.sourceData || { vdot: vdotValue }
    }

    // Validate first_day_of_week if provided
    const firstDayOfWeek = first_day_of_week !== undefined ? first_day_of_week : 1  // Default to Monday
    if (firstDayOfWeek !== 0 && firstDayOfWeek !== 1) {
      return NextResponse.json(
        { error: 'Invalid first_day_of_week (must be 0 for Sunday or 1 for Monday)' },
        { status: 400 }
      )
    }

    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }
    const athleteId = user.id

    // Load template summary and full template
    const summary = await getTemplateSummary(template_id)
    if (!summary) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }
    const fullTemplate = await loadFullTemplate(template_id)

    // Calculate when structured training officially begins (next Monday/Sunday)
    const startDateObj = new Date(start_date)
    const currentDay = startDateObj.getDay()
    const daysUntilTarget = firstDayOfWeek === currentDay ? 0 : ((firstDayOfWeek - currentDay + 7) % 7)
    const planStartDateObj = new Date(startDateObj)
    planStartDateObj.setDate(startDateObj.getDate() + daysUntilTarget)
    const planStartDate = planStartDateObj.toISOString().split('T')[0]

    const goalDateObj = new Date(goal_date)
    const weeksNeeded = computeWeeksAvailable(planStartDateObj, goalDateObj)
    const raceDayOfWeek = goalDateObj.getDay()
    const raceDayNumber = raceDayOfWeek === firstDayOfWeek ? 1 : ((raceDayOfWeek - firstDayOfWeek + 7) % 7) + 1

    // Athlete's preferred provider/model (engine) + units (prompt) + vdot (save decision)
    const { data: athlete } = await supabase
      .from('athletes')
      .select('preferred_llm_provider, preferred_llm_model, preferred_units, vdot')
      .eq('id', athleteId)
      .single()

    // Detect time-based templates (run/walk progression, C25K-style)
    const isTimeBased = summary.tags?.includes('time_based') ||
      summary.characteristics?.structure_type === 'run_walk_progression'

    const systemPrompt = buildGenerationSystemPrompt({
      template: fullTemplate,
      criteria: user_criteria as unknown as UserCriteria,
      goal_date,
      start_date,
      goal_type: goal_type as import('@/lib/templates/types').RaceDistance,
      first_day_of_week: firstDayOfWeek as 0 | 1,
      preferred_units: (athlete?.preferred_units ?? 'metric') as 'metric' | 'imperial',
      isTimeBased,
    })
    const userMessage = buildGenerationUserMessage(fullTemplate)

    // Demo account: pin the cheap provider regardless of stored preference.
    const demoOverride = demoProviderOverride(athleteId)

    const result = await generatePlan({
      supabase,
      athleteId,
      athlete: athlete
        ? {
            preferred_llm_provider: demoOverride ? demoOverride.providerName : athlete.preferred_llm_provider,
            preferred_llm_model: demoOverride ? demoOverride.modelName ?? null : athlete.preferred_llm_model,
            vdot: athlete.vdot,
          }
        : null,
      systemPrompt,
      userMessage,
      startDate: start_date,
      planStartDate,
      goalDate: goal_date,
      weeksNeeded,
      raceDayNumber,
      goalName: goal_name || `${goal_type.replace('_', ' ')} - ${summary.name}`,
      planName: goal_name || summary.name,
      goalType: goal_type,
      distanceMeters: RACE_DISTANCES[goal_type as keyof typeof RACE_DISTANCES] ?? null,
      vdot,
      trainingPaces,
      paceSource,
      paceSourceData,
      template: fullTemplate,
      planFields: { template_id, template_version: '1.0', user_criteria },
      writeOptions: { paceTargets: fullTemplate.pace_targets, templateId: fullTemplate.template_id },
      replaceActive: replace_active,
      llmLogKey: 'plan-generate',
    })

    return NextResponse.json({
      plan_id: result.planId,
      status: 'draft_generated',
      template_used: summary.name,
      summary: result.summary,
      token_usage: result.tokenUsage,
    })
  } catch (error) {
    if (error instanceof ActivePlanExistsError) {
      return NextResponse.json(
        { error: 'active_plan_exists', active_plan: error.activePlan },
        { status: 409 }
      )
    }
    console.error('Error generating plan:', error)
    return NextResponse.json(
      { error: 'Failed to generate plan', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export const POST = withRateLimit('generation', postHandler)
