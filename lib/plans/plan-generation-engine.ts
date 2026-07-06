import type { SupabaseClient } from '@supabase/supabase-js'
import type { FullTemplate } from '@/lib/templates/types'
import type { TrainingPaces } from '@/types/database'
import { createLLMProvider } from '@/lib/agent/factory'
import { writeLLMLog } from '@/lib/agent/llm-logger'
import { parseLLMResponse } from '@/lib/plans/response-parser'
import { writePlanToDatabase } from '@/lib/plans/plan-writer'
import { deriveTotals } from '@/lib/plans/derive-totals'
import {
  runStructuralAssertions,
  assertWeekStructure,
  assertRaceDay,
  assertSessionsHaveMainSet,
} from '@/lib/plans/structural-assertions'
import { enrichParsedWorkouts, enrichPreWeekWorkouts } from '@/lib/plans/structured-workout-builder'
import { plansOverlap, truncateAndArchivePlan } from '@/lib/supabase/plan-activation'

/**
 * Shared plan-generation engine used by BOTH template generation
 * (`/api/plans/generate`) and imported-plan scheduling
 * (`/api/plans/import/[id]/generate`). Everything from the active-plan guard
 * through writePlanToDatabase lives here once; callers differ only in how they
 * build the prompt and in their provenance (`planFields`) + response shape.
 *
 * This is a verbatim extraction of the template route's orchestration — the
 * template path's observable behaviour (provider selection, truncation handling,
 * structural assertions, 409 guard, draft cleanup, inserts) is unchanged.
 */

/** Thrown when an active plan exists and the caller did not opt into replacing it. */
export class ActivePlanExistsError extends Error {
  activePlan: { id: number; name: string }
  constructor(activePlan: { id: number; name: string }) {
    super('active_plan_exists')
    this.name = 'ActivePlanExistsError'
    this.activePlan = activePlan
  }
}

export interface PlanGenerationInput {
  supabase: SupabaseClient
  athleteId: string
  /** Athlete row bits the engine needs (provider selection + save-VDOT decision). */
  athlete: {
    preferred_llm_provider: string | null
    preferred_llm_model: string | null
    vdot: number | null
  } | null
  // Prompt — the only source-specific input (template vs imported framing).
  systemPrompt: string
  userMessage: string
  // Timeline
  startDate: string        // user's selected start (→ writer userStartDate)
  planStartDate: string    // Week-1 anchored start
  goalDate: string
  weeksNeeded: number
  raceDayNumber: number
  // Goal / plan
  goalName: string         // athlete_goals.goal_name
  planName: string         // training_plans.name
  goalType: string
  distanceMeters: number | null
  // Paces
  vdot: number | null
  trainingPaces: TrainingPaces | null
  paceSource: string | null
  paceSourceData: Record<string, unknown> | null
  // Assertions: template present → runStructuralAssertions (advisory + blocking);
  // absent → the three blocking asserts only.
  template?: FullTemplate
  // Provenance merged into the training_plans insert
  planFields: Record<string, unknown>
  // Writer extras (athletePaces is always trainingPaces; the rest set here)
  writeOptions?: { paceTargets?: FullTemplate['pace_targets']; templateId?: string }
  replaceActive?: boolean
  llmLogKey: string
  llmLogExtra?: Record<string, unknown>
  /** Imported path uses this to record an application row after the plan exists. */
  onPlanCreated?: (planId: number) => Promise<void>
}

export interface PlanGenerationResult {
  planId: number
  summary: unknown
  tokenUsage: { inputTokens: number; outputTokens: number }
}

const MAX_TOKENS_MAP: Record<string, number> = {
  gemini: 65536,
  anthropic: 64000,
  grok: 131072,
  openai: 16000,
  deepseek: 8192,
}

export async function generatePlan(input: PlanGenerationInput): Promise<PlanGenerationResult> {
  const {
    supabase, athleteId, athlete, systemPrompt, userMessage,
    startDate, planStartDate, goalDate, weeksNeeded, raceDayNumber,
    goalName, planName, goalType, distanceMeters,
    vdot, trainingPaces, paceSource, paceSourceData,
    template, planFields, writeOptions, replaceActive,
    llmLogKey, llmLogExtra, onPlanCreated,
  } = input

  // Pre-flight (kept before the billable LLM call): a new plan may be generated
  // and held as a draft alongside the active plan, as long as their date ranges
  // don't overlap — consecutive plans have distinct week_start_dates so they
  // won't collide on the weekly_plans (athlete_id, week_start_date) unique index.
  // Only an OVERLAPPING new plan needs the active one out of the way; that
  // requires the caller to opt in (replaceActive), which truncates+archives it.
  const { data: activePlan, error: activePlanError } = await supabase
    .from('training_plans')
    .select('id, name, start_date, end_date')
    .eq('athlete_id', athleteId)
    .eq('status', 'active')
    .maybeSingle()
  if (activePlanError) throw activePlanError
  const overlapsActive =
    !!activePlan && plansOverlap(startDate, goalDate, activePlan.start_date, activePlan.end_date)
  if (overlapsActive && !replaceActive) {
    throw new ActivePlanExistsError({ id: activePlan!.id, name: activePlan!.name })
  }

  // If athlete has no VDOT in profile but one was provided for this plan, save it.
  if (vdot && athlete && !athlete.vdot) {
    await supabase
      .from('athletes')
      .update({ vdot, training_paces: trainingPaces, pace_source: paceSource, pace_source_data: paceSourceData })
      .eq('id', athleteId)
  }

  // Provider selection:
  //   1. User's explicitly preferred provider → respect it.
  //   2. Else GEMINI_API_KEY → Gemini Flash Lite (fast, high output budget, cheap).
  //   3. Else deepseek-chat.
  const userProviderName = athlete?.preferred_llm_provider || null
  const userModelName = athlete?.preferred_llm_model || undefined

  let planProviderName: string
  let planModelName: string | undefined
  if (userProviderName) {
    planProviderName = userProviderName
    planModelName = (userProviderName === 'deepseek' && !userModelName) ? 'deepseek-chat' : userModelName
  } else if (process.env.GEMINI_API_KEY) {
    planProviderName = 'gemini'
    planModelName = 'gemini-2.5-flash-lite'
  } else {
    planProviderName = 'deepseek'
    planModelName = 'deepseek-chat'
  }

  const provider = createLLMProvider(planProviderName, planModelName)
  const maxTokens = MAX_TOKENS_MAP[planProviderName] || 8192

  const llmStartTime = Date.now()
  const response = await provider.generateResponse({
    messages: [{ role: 'user', content: userMessage }],
    systemPrompt,
    maxTokens,
    temperature: 0.7,
  })
  const llmDurationSec = ((Date.now() - llmStartTime) / 1000).toFixed(2)

  writeLLMLog(llmLogKey, {
    provider: planProviderName,
    model: planModelName,
    generationTimeSeconds: parseFloat(llmDurationSec),
    systemPrompt,
    userMessage,
    response: response.content,
    usage: response.usage,
    ...llmLogExtra,
  })

  // Detect truncation (hit token limit) for a clearer parse-error message.
  const wasLikelyTruncated = response.usage.outputTokens >= maxTokens * 0.98

  let parsedPlan
  try {
    parsedPlan = parseLLMResponse(response.content)
  } catch (parseError) {
    console.error('JSON Parse Error - Response content:', response.content)
    if (wasLikelyTruncated) {
      throw new Error(`LLM response was truncated at ${response.usage.outputTokens} tokens. The plan was incomplete. Try using a provider with higher token limits (OpenAI: 16000 tokens) or reduce the plan duration.`)
    }
    throw parseError
  }

  // Normalize structured_workout shape from LLM output.
  for (const week of parsedPlan.weeks) {
    enrichParsedWorkouts(week.workouts)
  }
  if (parsedPlan.preWeekWorkouts) {
    enrichPreWeekWorkouts(parsedPlan.preWeekWorkouts)
  }

  // Derive distance_meters per workout + weekly_total_km per week.
  deriveTotals(parsedPlan, trainingPaces)

  // Structural assertions. Template present → include the template-aware advisory
  // back-to-back check; absent (imported) → blocking checks only.
  let blocking: string[]
  if (template) {
    const structural = runStructuralAssertions(parsedPlan, template, weeksNeeded, raceDayNumber)
    if (structural.advisory.length > 0) {
      console.warn(`Structural advisories (${structural.advisory.length}):`)
      structural.advisory.forEach(a => console.warn(`  - ${a}`))
    }
    blocking = structural.blocking
  } else {
    blocking = [
      ...assertWeekStructure(parsedPlan, weeksNeeded),
      ...assertRaceDay(parsedPlan, weeksNeeded, raceDayNumber),
      ...assertSessionsHaveMainSet(parsedPlan),
    ]
  }
  if (blocking.length > 0) {
    console.error('Structural assertion failures:')
    blocking.forEach(f => console.error(`  - ${f}`))
    throw new Error(`Generated plan failed structural validation:\n${blocking.map(f => `  • ${f}`).join('\n')}`)
  }

  // LLM succeeded — now mutate the database.
  // Overlapping replacement: shorten the outgoing plan to end the day before the
  // new one starts and free its colliding weeks, keeping earlier history intact.
  if (overlapsActive && replaceActive) {
    await truncateAndArchivePlan(supabase, activePlan!.id, athleteId, startDate)
  }

  const { data: existingDrafts } = await supabase
    .from('training_plans')
    .select('id')
    .eq('athlete_id', athleteId)
    .in('status', ['draft', 'draft_generated'])
  if (existingDrafts && existingDrafts.length > 0) {
    await supabase.from('training_plans').delete().in('id', existingDrafts.map(d => d.id))
  }

  const { data: goal, error: goalError } = await supabase
    .from('athlete_goals')
    .insert({
      athlete_id: athleteId,
      goal_type: 'race',
      goal_name: goalName,
      target_date: goalDate,
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
      name: planName,
      start_date: startDate,
      end_date: goalDate,
      plan_type: goalType,
      status: 'draft_generated',
      created_by: 'agent',
      vdot,
      training_paces: trainingPaces,
      pace_source: paceSource,
      pace_source_data: paceSourceData,
      ...planFields,
    })
    .select()
    .single()
  if (planError) throw planError

  const writeResult = await writePlanToDatabase(parsedPlan, {
    planId: plan.id,
    planStartDate,
    userStartDate: startDate,
    goalDate,
    supabase,
    athletePaces: trainingPaces,
    ...writeOptions,
  })

  await onPlanCreated?.(plan.id)

  return { planId: plan.id, summary: writeResult, tokenUsage: response.usage }
}
