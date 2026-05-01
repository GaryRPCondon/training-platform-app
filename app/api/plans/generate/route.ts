import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { loadFullTemplate, getTemplateSummary } from '@/lib/templates/template-loader'
import { buildGenerationSystemPrompt, buildGenerationUserMessage } from '@/lib/plans/llm-prompts'
import { parseLLMResponse } from '@/lib/plans/response-parser'
import { writePlanToDatabase } from '@/lib/plans/plan-writer'
import { deriveTotals } from '@/lib/plans/derive-totals'
import { runStructuralAssertions } from '@/lib/plans/structural-assertions'
import { enrichParsedWorkouts, enrichPreWeekWorkouts } from '@/lib/plans/structured-workout-builder'
import { createLLMProvider } from '@/lib/agent/factory'
import { calculateTrainingPaces, calculateRacePaces, RACE_DISTANCES } from '@/lib/training/vdot'
import type { UserCriteria } from '@/lib/templates/types'
import type { TrainingPaces } from '@/types/database'
import { writeLLMLog } from '@/lib/agent/llm-logger'
import { archivePlanAndGoal } from '@/lib/supabase/plan-activation'
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

export async function POST(request: Request) {
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

      console.log(`VDOT: ${vdotValue}, Training paces calculated for plan`)
    }

    // Validate first_day_of_week if provided
    const firstDayOfWeek = first_day_of_week !== undefined ? first_day_of_week : 1  // Default to Monday
    if (firstDayOfWeek !== 0 && firstDayOfWeek !== 1) {
      return NextResponse.json(
        { error: 'Invalid first_day_of_week (must be 0 for Sunday or 1 for Monday)' },
        { status: 400 }
      )
    }

    // Create server-side supabase client
    const supabase = await createClient()

    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      )
    }

    const athleteId = user.id

    // Pre-flight: refuse to generate over an existing active plan unless the
    // caller explicitly opts in via replace_active. Without this guard, the
    // plan-writer hits a unique-constraint violation on weekly_plans when the
    // new plan's week dates collide with the active plan's.
    const { data: activePlan, error: activePlanError } = await supabase
      .from('training_plans')
      .select('id, name')
      .eq('athlete_id', athleteId)
      .eq('status', 'active')
      .maybeSingle()
    if (activePlanError) throw activePlanError

    if (activePlan && !replace_active) {
      return NextResponse.json(
        {
          error: 'active_plan_exists',
          active_plan: { id: activePlan.id, name: activePlan.name },
        },
        { status: 409 }
      )
    }

    // Load template summary and full template
    const summary = await getTemplateSummary(template_id)
    if (!summary) {
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 }
      )
    }

    const fullTemplate = await loadFullTemplate(template_id)

    // Calculate when structured training officially begins (next Monday/Sunday from start_date)
    const startDateObj = new Date(start_date)
    const currentDay = startDateObj.getDay()
    const daysUntilTarget = firstDayOfWeek === currentDay ? 0 :
      ((firstDayOfWeek - currentDay + 7) % 7)
    const planStartDateObj = new Date(startDateObj)
    planStartDateObj.setDate(startDateObj.getDate() + daysUntilTarget)
    const planStartDate = planStartDateObj.toISOString().split('T')[0]

    // Compute weeks_needed and race day number — also needed by structural assertions
    const goalDateObj = new Date(goal_date)
    const daysFromPlanStartToGoal = Math.floor(
      (goalDateObj.getTime() - planStartDateObj.getTime()) / (1000 * 60 * 60 * 24)
    )
    const weeksNeeded = Math.floor(daysFromPlanStartToGoal / 7) + 1
    const raceDayOfWeek = goalDateObj.getDay()
    const raceDayNumber = raceDayOfWeek === firstDayOfWeek ? 1 :
      ((raceDayOfWeek - firstDayOfWeek + 7) % 7) + 1

    console.log(`Start date: ${start_date}, Plan start (Week 1): ${planStartDate}, First day of week: ${firstDayOfWeek === 0 ? 'Sunday' : 'Monday'}`)

    // Get athlete's preferred LLM provider, model, and unit preference
    const { data: athlete } = await supabase
      .from('athletes')
      .select('preferred_llm_provider, preferred_llm_model, preferred_units, vdot')
      .eq('id', athleteId)
      .single()

    // If athlete has no VDOT in profile but one was provided for this plan, save it
    if (vdot && athlete && !athlete.vdot) {
      await supabase
        .from('athletes')
        .update({
          vdot,
          training_paces: trainingPaces,
          pace_source: paceSource,
          pace_source_data: paceSourceData,
        })
        .eq('id', athleteId)
    }

    // Detect time-based templates (run/walk progression, C25K-style)
    const isTimeBased = summary.tags?.includes('time_based') ||
      summary.characteristics?.structure_type === 'run_walk_progression'

    // Build LLM prompts FIRST (before creating any database records)
    const context = {
      template: fullTemplate,
      criteria: user_criteria as unknown as UserCriteria,
      goal_date,
      start_date,
      goal_type: goal_type as import('@/lib/templates/types').RaceDistance,
      first_day_of_week: firstDayOfWeek as 0 | 1,
      preferred_units: (athlete?.preferred_units ?? 'metric') as 'metric' | 'imperial',
      isTimeBased,
    }

    const systemPrompt = buildGenerationSystemPrompt(context)
    const userMessage = buildGenerationUserMessage(fullTemplate)

    // Log request size for debugging
    const systemPromptLength = systemPrompt.length
    const userMessageLength = userMessage.length
    const estimatedTokens = Math.ceil((systemPromptLength + userMessageLength) / 4)
    console.log(`LLM Request - System: ${systemPromptLength} chars, User: ${userMessageLength} chars, Est tokens: ${estimatedTokens}`)

    // Plan-generation provider selection:
    //   1. If user has explicitly set a preferred provider in their profile → respect it.
    //   2. Else if GEMINI_API_KEY is configured → use Gemini Flash Lite (preferred default
    //      for plan gen: ~30s response, 65K output tokens, low cost).
    //   3. Else fall back to deepseek-chat.
    const userProviderName = athlete?.preferred_llm_provider || null
    const userModelName = athlete?.preferred_llm_model || undefined

    let planProviderName: string
    let planModelName: string | undefined

    if (userProviderName) {
      // User explicitly chose a provider — respect it. For deepseek, prefer
      // deepseek-chat over deepseek-reasoner (reasoner exceeds Vercel's 300s
      // timeout; chat is faster but has an 8192 output-token limit).
      planProviderName = userProviderName
      planModelName = (userProviderName === 'deepseek' && !userModelName) ? 'deepseek-chat' : userModelName
    } else if (process.env.GEMINI_API_KEY) {
      planProviderName = 'gemini'
      planModelName = 'gemini-2.5-flash-lite'  // non-thinking model; avoids thinking tokens consuming output budget
    } else {
      planProviderName = 'deepseek'
      planModelName = 'deepseek-chat'
    }

    console.log(`Using LLM provider for plan generation: ${planProviderName}${planModelName ? ` (${planModelName})` : ''}`)
    const provider = createLLMProvider(planProviderName, planModelName)

    // Output token limits per provider
    const maxTokensMap: Record<string, number> = {
      'gemini':    65536,
      'anthropic': 64000,
      'grok':      131072,
      'openai':    16000,
      'deepseek':  8192,
    }
    const maxTokens = maxTokensMap[planProviderName] || 8192

    const llmStartTime = Date.now()
    const response = await provider.generateResponse({
      messages: [{ role: 'user', content: userMessage }],
      systemPrompt,
      maxTokens,
      temperature: 0.7
    })
    const llmEndTime = Date.now()
    const llmDurationMs = llmEndTime - llmStartTime
    const llmDurationSec = (llmDurationMs / 1000).toFixed(2)

    console.log(`LLM Response - Length: ${response.content.length} chars, Tokens used: ${response.usage.outputTokens}, Generation time: ${llmDurationSec}s`)

    // Log first and last 200 chars to debug JSON issues
    console.log('Response start:', response.content.substring(0, 200))
    console.log('Response end:', response.content.substring(response.content.length - 200))

    writeLLMLog('plan-generate', {
      provider: planProviderName,
      model: planModelName,
      generationTimeSeconds: parseFloat(llmDurationSec),
      systemPrompt,
      userMessage,
      response: response.content,
      usage: response.usage,
    })

    // Check if response was truncated (hit token limit)
    const wasLikelyTruncated = response.usage.outputTokens >= maxTokens * 0.98
    if (wasLikelyTruncated) {
      console.warn(`Response likely truncated - used ${response.usage.outputTokens}/${maxTokens} tokens`)
    }

    // Parse response
    let parsedPlan
    try {
      parsedPlan = parseLLMResponse(response.content)
    } catch (parseError) {
      console.error('JSON Parse Error - Response content:', response.content)

      // Provide helpful error message if truncated
      if (wasLikelyTruncated) {
        throw new Error(`LLM response was truncated at ${response.usage.outputTokens} tokens. The plan was incomplete. Try using a provider with higher token limits (OpenAI: 16000 tokens) or reduce the plan duration.`)
      }

      throw parseError
    }

    // Enrich parsed workouts: normalize structured_workout shape from LLM output.
    for (const week of parsedPlan.weeks) {
      enrichParsedWorkouts(week.workouts)
    }
    if (parsedPlan.preWeekWorkouts) {
      enrichPreWeekWorkouts(parsedPlan.preWeekWorkouts)
    }

    // Derive distance_meters per workout and weekly_total_km per week from structured_workout
    // components, using the athlete's training paces for time→distance conversion.
    deriveTotals(parsedPlan, trainingPaces)

    // Structural assertions — fail generation on real bugs (missing race day, wrong week count,
    // sessions without main_set). Back-to-back hard days are advisory only until templates
    // carry `hard_day_pattern` metadata. Drift is intentionally NOT checked.
    const structural = runStructuralAssertions(parsedPlan, fullTemplate, weeksNeeded, raceDayNumber)
    if (structural.advisory.length > 0) {
      console.warn(`Structural advisories (${structural.advisory.length}):`)
      structural.advisory.forEach(a => console.warn(`  - ${a}`))
    }
    if (structural.blocking.length > 0) {
      console.error('Structural assertion failures:')
      structural.blocking.forEach(f => console.error(`  - ${f}`))
      throw new Error(`Generated plan failed structural validation:\n${structural.blocking.map(f => `  • ${f}`).join('\n')}`)
    }

    // LLM succeeded! Now create the plan structure in the database

    // If the user opted to replace an existing active plan, archive it first
    // (and abandon its goal). Done after the LLM call so a generation failure
    // leaves the old plan untouched.
    if (activePlan && replace_active) {
      await archivePlanAndGoal(supabase, activePlan.id, athleteId)
    }

    // Check for existing draft and delete it
    const { data: existingDrafts } = await supabase
      .from('training_plans')
      .select('id')
      .eq('athlete_id', athleteId)
      .in('status', ['draft', 'draft_generated'])

    if (existingDrafts && existingDrafts.length > 0) {
      await supabase
        .from('training_plans')
        .delete()
        .in('id', existingDrafts.map(d => d.id))
    }

    // Create goal
    const { data: goal, error: goalError } = await supabase
      .from('athlete_goals')
      .insert({
        athlete_id: athleteId,
        goal_type: 'race',
        goal_name: goal_name || `${goal_type.replace('_', ' ')} - ${summary.name}`,
        target_date: goal_date,
        target_value: {
          distance_meters: RACE_DISTANCES[goal_type as keyof typeof RACE_DISTANCES]
        },
        status: 'active',
        priority: 1
      })
      .select()
      .single()

    if (goalError) throw goalError

    // Create training plan (draft_generated status - skipping draft since we already have workouts)
    const { data: plan, error: planError} = await supabase
      .from('training_plans')
      .insert({
        athlete_id: athleteId,
        goal_id: goal.id,
        name: goal_name || `${summary.name}`,
        start_date: start_date,
        end_date: goal_date,
        plan_type: goal_type,
        status: 'draft_generated',
        created_by: 'agent',
        template_id: template_id,
        template_version: '1.0',
        user_criteria: user_criteria,
        vdot: vdot,
        training_paces: trainingPaces,
        pace_source: paceSource,
        pace_source_data: paceSourceData
      })
      .select()
      .single()

    if (planError) throw planError

    // Write workouts to database (with resolved methodology paces)
    const writeResult = await writePlanToDatabase(parsedPlan, {
      planId: plan.id,
      planStartDate: planStartDate,  // Week 1 starts on next Monday/Sunday
      userStartDate: start_date,      // User's selected start date (for pre-week workouts)
      goalDate: goal_date,
      supabase: supabase,
      paceTargets: fullTemplate.pace_targets,
      athletePaces: trainingPaces,
    })

    return NextResponse.json({
      plan_id: plan.id,
      status: 'draft_generated',
      template_used: summary.name,
      summary: writeResult,
      token_usage: response.usage,
    })

  } catch (error) {
    console.error('Error generating plan:', error)

    // No cleanup needed - we don't create anything in the database until LLM succeeds

    return NextResponse.json(
      {
        error: 'Failed to generate plan',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
