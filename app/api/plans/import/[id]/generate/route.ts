import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { withRateLimit } from '@/lib/rate-limit/with-rate-limit'
import { generateImportRequestSchema, parsedRunningPlanSchema } from '@/lib/plans/import/schemas'
import { getImportedRunPlan } from '@/lib/supabase/import-run-plan-queries'
import {
  buildImportedGenerationSystemPrompt,
  buildImportedGenerationUserMessage,
} from '@/lib/plans/import/generation-prompts'
import { parseLLMResponse } from '@/lib/plans/response-parser'
import { writePlanToDatabase } from '@/lib/plans/plan-writer'
import { deriveTotals } from '@/lib/plans/derive-totals'
import {
  assertWeekStructure,
  assertRaceDay,
  assertSessionsHaveMainSet,
} from '@/lib/plans/structural-assertions'
import { enrichParsedWorkouts, enrichPreWeekWorkouts } from '@/lib/plans/structured-workout-builder'
import { createLLMProvider } from '@/lib/agent/factory'
import { calculateTrainingPaces, calculateRacePaces, RACE_DISTANCES } from '@/lib/training/vdot'
import type { RaceDistance } from '@/lib/templates/types'
import type { TrainingPaces } from '@/types/database'
import { writeLLMLog } from '@/lib/agent/llm-logger'
import { archivePlanAndGoal } from '@/lib/supabase/plan-activation'

interface Ctx { params: Promise<{ id: string }> }

const MAX_TOKENS_MAP: Record<string, number> = {
  gemini: 65536, anthropic: 64000, grok: 131072, openai: 16000, deepseek: 8192,
}

// Schedule (deploy) an imported plan: the stored definition is guidance; the LLM
// tailors it to the athlete's volume / training days / timeline, mirroring
// template generation. Produces a draft the user reviews.
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

    const firstDayOfWeek = 1 // Monday — matches the template generation default
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

    // Pre-flight: refuse to generate over an active plan unless opted in.
    const { data: activePlan } = await supabase
      .from('training_plans')
      .select('id, name')
      .eq('athlete_id', athleteId)
      .eq('status', 'active')
      .maybeSingle()
    if (activePlan && !data.replace_active) {
      return NextResponse.json(
        { error: 'active_plan_exists', active_plan: { id: activePlan.id, name: activePlan.name } },
        { status: 409 },
      )
    }

    const { data: athlete } = await supabase
      .from('athletes')
      .select('preferred_llm_provider, preferred_llm_model, preferred_units, vdot')
      .eq('id', athleteId)
      .single()

    if (vdot && athlete && !athlete.vdot) {
      await supabase
        .from('athletes')
        .update({ vdot, training_paces: trainingPaces, pace_source: paceSource, pace_source_data: paceSourceData })
        .eq('id', athleteId)
    }

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

    // Provider selection mirrors the template generate route.
    let planProviderName: string
    let planModelName: string | undefined
    if (athlete?.preferred_llm_provider) {
      planProviderName = athlete.preferred_llm_provider
      planModelName = (planProviderName === 'deepseek' && !athlete.preferred_llm_model)
        ? 'deepseek-chat'
        : (athlete.preferred_llm_model || undefined)
    } else if (process.env.GEMINI_API_KEY) {
      planProviderName = 'gemini'
      planModelName = 'gemini-2.5-flash-lite'
    } else {
      planProviderName = 'deepseek'
      planModelName = 'deepseek-chat'
    }
    const maxTokens = MAX_TOKENS_MAP[planProviderName] || 8192
    const provider = createLLMProvider(planProviderName, planModelName)

    const llmStart = Date.now()
    const response = await provider.generateResponse({
      messages: [{ role: 'user', content: userMessage }],
      systemPrompt,
      maxTokens,
      temperature: 0.7,
    })
    writeLLMLog('imported-plan-generate', {
      importedRunPlanId: imported.id,
      provider: planProviderName,
      model: planModelName,
      generationTimeSeconds: (Date.now() - llmStart) / 1000,
      systemPrompt,
      userMessage,
      response: response.content,
      usage: response.usage,
    })

    const parsedPlan = parseLLMResponse(response.content)
    for (const week of parsedPlan.weeks) enrichParsedWorkouts(week.workouts)
    if (parsedPlan.preWeekWorkouts) enrichPreWeekWorkouts(parsedPlan.preWeekWorkouts)
    deriveTotals(parsedPlan, trainingPaces)

    // Blocking structural checks (no template needed; B2B advisory is skipped —
    // imported books legitimately schedule consecutive hard days).
    const blocking = [
      ...assertWeekStructure(parsedPlan, weeksNeeded),
      ...assertRaceDay(parsedPlan, weeksNeeded, raceDayNumber),
      ...assertSessionsHaveMainSet(parsedPlan),
    ]
    if (blocking.length > 0) {
      throw new Error(`Generated plan failed structural validation:\n${blocking.map(f => `  • ${f}`).join('\n')}`)
    }

    if (activePlan && data.replace_active) {
      await archivePlanAndGoal(supabase, activePlan.id, athleteId)
    }
    const { data: existingDrafts } = await supabase
      .from('training_plans')
      .select('id')
      .eq('athlete_id', athleteId)
      .in('status', ['draft', 'draft_generated'])
    if (existingDrafts && existingDrafts.length > 0) {
      await supabase.from('training_plans').delete().in('id', existingDrafts.map(d => d.id))
    }

    const distanceMeters = RACE_DISTANCES[data.goal_type as keyof typeof RACE_DISTANCES] ?? null
    const { data: goal, error: goalError } = await supabase
      .from('athlete_goals')
      .insert({
        athlete_id: athleteId,
        goal_type: 'race',
        goal_name: data.goal_name,
        target_date: data.goal_date,
        target_value: { distance_meters: distanceMeters },
        status: 'active',
        priority: 1,
      })
      .select()
      .single()
    if (goalError) throw goalError

    const { data: plan, error: planError } = await supabase
      .from('training_plans')
      .insert({
        athlete_id: athleteId,
        goal_id: goal.id,
        name: data.goal_name,
        start_date: data.start_date,
        end_date: data.goal_date,
        plan_type: data.goal_type,
        status: 'draft_generated',
        created_by: 'agent',
        source: 'import',
        imported_run_plan_id: imported.id,
        vdot,
        training_paces: trainingPaces,
        pace_source: paceSource,
        pace_source_data: paceSourceData,
      })
      .select()
      .single()
    if (planError) throw planError

    const writeResult = await writePlanToDatabase(parsedPlan, {
      planId: plan.id,
      planStartDate,
      userStartDate: data.start_date,
      goalDate: data.goal_date,
      supabase,
      paceTargets: undefined,
      athletePaces: trainingPaces,
    })

    const { error: appError } = await supabase
      .from('imported_run_plan_applications')
      .insert({
        imported_run_plan_id: imported.id,
        training_plan_id: plan.id,
        athlete_id: athleteId,
        applied_start_date: planStartDate,
        applied_race_date: data.goal_date,
        fit_mode: 'llm_adapt',
      })
    if (appError) throw appError

    return NextResponse.json({
      plan_id: plan.id,
      status: 'draft_generated',
      summary: writeResult,
      token_usage: response.usage,
    })
  } catch (err) {
    console.error('Imported run plan generate error:', err)
    return NextResponse.json(
      { error: 'Failed to generate plan', details: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}

export const POST = withRateLimit('generation', postHandler)
