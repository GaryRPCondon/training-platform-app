import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { withRateLimit } from '@/lib/rate-limit/with-rate-limit'
import { generateImportRequestSchema, parsedRunningPlanSchema } from '@/lib/plans/import/schemas'
import { getImportedRunPlan } from '@/lib/supabase/import-run-plan-queries'
import {
  buildImportedGenerationSystemPrompt,
  buildImportedGenerationUserMessage,
} from '@/lib/plans/import/generation-prompts'
import { generatePlan, ActivePlanExistsError } from '@/lib/plans/plan-generation-engine'
import { calculateTrainingPaces, calculateRacePaces, RACE_DISTANCES } from '@/lib/training/vdot'
import type { RaceDistance } from '@/lib/templates/types'
import type { TrainingPaces } from '@/types/database'

interface Ctx { params: Promise<{ id: string }> }

// Schedule (deploy) an imported plan: the stored definition is guidance; the LLM
// tailors it to the athlete's volume / training days / timeline, mirroring
// template generation via the shared plan-generation engine. Produces a draft
// the user reviews.
async function postHandler(request: Request, { params }: Ctx) {
  const { id } = await params
  const planId = Number(id)
  if (!Number.isFinite(planId)) {
    return NextResponse.json({ error: 'Invalid plan id' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = generateImportRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const data = parsed.data
  if (data.goal_date <= data.start_date) {
    return NextResponse.json({ error: 'goal_date must be after start_date' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const athleteId = user.id

  try {
    const imported = await getImportedRunPlan(supabase, athleteId, planId)
    if (!imported) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Stored definition is trusted JSONB — revalidate before feeding the LLM.
    const definition = parsedRunningPlanSchema.parse(imported.definition)

    // VDOT → paces (optional).
    let vdot: number | null = null
    let trainingPaces: TrainingPaces | null = null
    let paceSource: string | null = null
    let paceSourceData: Record<string, unknown> | null = null
    if (data.vdot_data && typeof data.vdot_data.vdot === 'number') {
      vdot = data.vdot_data.vdot
      trainingPaces = { ...calculateTrainingPaces(vdot), ...calculateRacePaces(vdot) }
      paceSource = data.vdot_data.source || 'vdot_direct'
      paceSourceData = data.vdot_data.sourceData || { vdot }
    }

    const firstDayOfWeek = 1 // Monday — matches template generation default
    const startDateObj = new Date(data.start_date)
    const currentDay = startDateObj.getDay()
    const daysUntilTarget = firstDayOfWeek === currentDay ? 0 : ((firstDayOfWeek - currentDay + 7) % 7)
    const planStartDateObj = new Date(startDateObj)
    planStartDateObj.setDate(startDateObj.getDate() + daysUntilTarget)
    const planStartDate = planStartDateObj.toISOString().split('T')[0]

    const goalDateObj = new Date(data.goal_date)
    const daysFromPlanStartToGoal = Math.round((goalDateObj.getTime() - planStartDateObj.getTime()) / 86400000)
    const weeksNeeded = Math.floor(daysFromPlanStartToGoal / 7) + 1
    const raceDayOfWeek = goalDateObj.getDay()
    const raceDayNumber = raceDayOfWeek === firstDayOfWeek ? 1 : ((raceDayOfWeek - firstDayOfWeek + 7) % 7) + 1

    const { data: athlete } = await supabase
      .from('athletes')
      .select('preferred_llm_provider, preferred_llm_model, preferred_units, vdot')
      .eq('id', athleteId)
      .single()

    const systemPrompt = buildImportedGenerationSystemPrompt({
      definition,
      criteria: {
        current_weekly_mileage: data.current_weekly_mileage,
        comfortable_peak_mileage: data.comfortable_peak_mileage,
        days_per_week: data.days_per_week,
        preferred_rest_days: data.preferred_rest_days,
      },
      goal_date: data.goal_date,
      start_date: data.start_date,
      goal_type: data.goal_type as RaceDistance,
      first_day_of_week: firstDayOfWeek,
      preferred_units: (athlete?.preferred_units ?? 'metric') as 'metric' | 'imperial',
    })
    const userMessage = buildImportedGenerationUserMessage(definition)

    const result = await generatePlan({
      supabase,
      athleteId,
      athlete: athlete
        ? { preferred_llm_provider: athlete.preferred_llm_provider, preferred_llm_model: athlete.preferred_llm_model, vdot: athlete.vdot }
        : null,
      systemPrompt,
      userMessage,
      startDate: data.start_date,
      planStartDate,
      goalDate: data.goal_date,
      weeksNeeded,
      raceDayNumber,
      goalName: data.goal_name,
      planName: data.goal_name,
      goalType: data.goal_type,
      distanceMeters: RACE_DISTANCES[data.goal_type as keyof typeof RACE_DISTANCES] ?? null,
      vdot,
      trainingPaces,
      paceSource,
      paceSourceData,
      // No template → engine runs blocking structural asserts only (imported
      // books legitimately schedule consecutive hard days).
      planFields: { source: 'import', imported_run_plan_id: imported.id },
      writeOptions: { paceTargets: undefined },
      replaceActive: data.replace_active,
      llmLogKey: 'imported-plan-generate',
      llmLogExtra: { importedRunPlanId: imported.id },
      onPlanCreated: async (createdPlanId) => {
        const { error: appError } = await supabase
          .from('imported_run_plan_applications')
          .insert({
            imported_run_plan_id: imported.id,
            training_plan_id: createdPlanId,
            athlete_id: athleteId,
            applied_start_date: planStartDate,
            applied_race_date: data.goal_date,
            fit_mode: 'llm_adapt',
          })
        if (appError) throw appError
      },
    })

    return NextResponse.json({
      plan_id: result.planId,
      status: 'draft_generated',
      summary: result.summary,
      token_usage: result.tokenUsage,
    })
  } catch (err) {
    if (err instanceof ActivePlanExistsError) {
      return NextResponse.json(
        { error: 'active_plan_exists', active_plan: err.activePlan },
        { status: 409 },
      )
    }
    console.error('Imported run plan generate error:', err)
    return NextResponse.json(
      { error: 'Failed to generate plan', details: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}

export const POST = withRateLimit('generation', postHandler)
