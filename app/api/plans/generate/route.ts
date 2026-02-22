import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { loadFullTemplate, getTemplateSummary } from '@/lib/templates/template-loader'
import { buildGenerationSystemPrompt, buildGenerationUserMessage } from '@/lib/plans/llm-prompts'
import { parseLLMResponse } from '@/lib/plans/response-parser'
import { writePlanToDatabase, clearPlanWorkouts } from '@/lib/plans/plan-writer'
import { validateWorkoutDistances } from '@/lib/plans/workout-validator'
import { createLLMProvider } from '@/lib/agent/factory'
import { calculateTrainingPaces } from '@/lib/training/vdot'
import type { UserCriteria } from '@/lib/templates/types'
import type { TrainingPaces } from '@/types/database'
import { writeFileSync } from 'fs'
import { join } from 'path'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { template_id, goal_date, start_date, goal_type, goal_name, user_criteria, first_day_of_week, vdot_data } = body

    // Validate request
    if (!template_id || !goal_date || !start_date || !goal_type || !user_criteria) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Calculate training paces if VDOT data provided
    let vdot: number | null = null
    let trainingPaces: TrainingPaces | null = null
    let paceSource: string | null = null
    let paceSourceData: any = null

    if (vdot_data && typeof vdot_data === 'object' && typeof vdot_data.vdot === 'number') {
      const vdotValue = vdot_data.vdot
      vdot = vdotValue
      trainingPaces = calculateTrainingPaces(vdotValue)
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

    console.log(`Start date: ${start_date}, Plan start (Week 1): ${planStartDate}, First day of week: ${firstDayOfWeek === 0 ? 'Sunday' : 'Monday'}`)

    // Get athlete's preferred LLM provider, model, and unit preference
    const { data: athlete } = await supabase
      .from('athletes')
      .select('preferred_llm_provider, preferred_llm_model, preferred_units')
      .eq('id', athleteId)
      .single()

    // Build LLM prompts FIRST (before creating any database records)
    const context = {
      template: fullTemplate,
      criteria: user_criteria as UserCriteria,
      goal_date,
      start_date,
      first_day_of_week: firstDayOfWeek as 0 | 1,
      preferred_units: (athlete?.preferred_units ?? 'metric') as 'metric' | 'imperial',
    }

    const systemPrompt = buildGenerationSystemPrompt(context)
    const userMessage = buildGenerationUserMessage(fullTemplate)

    // Log request size for debugging
    const systemPromptLength = systemPrompt.length
    const userMessageLength = userMessage.length
    const estimatedTokens = Math.ceil((systemPromptLength + userMessageLength) / 4)
    console.log(`LLM Request - System: ${systemPromptLength} chars, User: ${userMessageLength} chars, Est tokens: ${estimatedTokens}`)

    // For plan generation, use provider with sufficient token limits
    // Old deepseek-chat had 8192 limit, but deepseek-reasoner has higher limits
    let providerName = athlete?.preferred_llm_provider || 'deepseek'

    const modelName = athlete?.preferred_llm_model || undefined

    console.log(`Using LLM provider: ${providerName}${modelName ? ` with model: ${modelName}` : ''}`)
    const provider = createLLMProvider(providerName, modelName)

    // Call LLM
    // Note: Token limits vary by provider - these are output (completion) limits
    const maxTokensMap: Record<string, number> = {
      'deepseek': 32768,  // DeepSeek R1 (deepseek-reasoner) supports up to 32K output tokens
      'gemini': 65536,    // Gemini 2.5 Flash supports up to 65536 output tokens
      'anthropic': 64000, // Claude Sonnet 4.5 supports up to 64K output tokens
      'openai': 16000,
      'grok': 131072      // Grok 4.1 Fast supports up to 131K output tokens
    }
    const maxTokens = maxTokensMap[providerName] || 8192

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

    // Log the FULL response to a file for inspection
    const timestamp = new Date().toISOString().replace(/:/g, '-')
    const logPath = join(process.cwd(), `llm-response-${timestamp}.json`)
    writeFileSync(logPath, JSON.stringify({
      timestamp,
      provider: providerName,
      model: modelName,
      generationTimeSeconds: parseFloat(llmDurationSec),
      systemPrompt,
      userMessage: userMessage.substring(0, 1000) + '... (truncated)',
      response: response.content,
      usage: response.usage
    }, null, 2))
    console.log(`Full LLM response saved to: ${logPath}`)

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

    // Validate workout distances for potential LLM hallucinations
    const validationWarnings = validateWorkoutDistances(parsedPlan)
    if (validationWarnings.length > 0) {
      console.warn(`⚠️  Found ${validationWarnings.length} potential hallucinations:`)
      validationWarnings.forEach(w => console.warn(`  - ${w.message}`))
    }

    // LLM succeeded! Now create the plan structure in the database

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
        goal_name: goal_name || `${goal_type.replace('_', ' ')} - ${summary.name}`,
        target_date: goal_date,
        target_value: {
          distance_meters: goalDistances[goal_type]
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

    // Write workouts to database
    const writeResult = await writePlanToDatabase(parsedPlan, {
      planId: plan.id,
      planStartDate: planStartDate,  // Week 1 starts on next Monday/Sunday
      userStartDate: start_date,      // User's selected start date (for pre-week workouts)
      goalDate: goal_date,
      supabase: supabase
    })

    return NextResponse.json({
      plan_id: plan.id,
      status: 'draft_generated',
      template_used: summary.name,
      summary: writeResult,
      token_usage: response.usage,
      warnings: validationWarnings
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
