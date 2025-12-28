/**
 * /api/plans/regenerate - Phase 5 Chat Refinement
 *
 * Endpoint for LLM-based plan modifications.
 *
 * DUAL MODE ARCHITECTURE:
 *
 * Mode: "operations" (default)
 * - LLM outputs discrete operations (~200 tokens)
 * - Code applies operations deterministically
 * - Original data preserved automatically
 * - Fast, reliable, no field drift
 *
 * Mode: "full" (fallback)
 * - LLM regenerates complete weeks (~20k tokens)
 * - Used when operations can't express the change
 * - User must explicitly confirm (takes 5-10 minutes)
 *
 * Flow:
 * 1. User sends modification request
 * 2. Default: Try operations mode first
 * 3. If LLM returns fallback indicator → return fallback_required to UI
 * 4. If user confirms → call with mode=full
 * 5. Return preview for user approval
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createLLMProvider } from '@/lib/agent/factory'
import { loadFullPlanContext } from '@/lib/chat/plan-context-loader'
import { extractWorkoutReferences } from '@/lib/chat/intent-parser'
import {
  buildRegenerationPrompt,
  validateRegeneratedWeeks,
  formatValidationErrors
} from '@/lib/chat/regeneration-prompts'
import {
  buildOperationPrompt,
  parseOperationResponse
} from '@/lib/chat/operation-prompts'
import {
  validateOperations,
  previewOperations,
  describeOperation
} from '@/lib/plans/operations'
import { calculateMaxTokens, estimateTokens } from '@/lib/chat/token-budget'
import { writeFileSync } from 'fs'
import { join } from 'path'

type RegenerateMode = 'operations' | 'full'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    // Get current user
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Parse request body
    const body = await request.json()
    const { planId, userMessage, mode: requestedMode } = body

    // Mode: 'operations' (default) or 'full' (fallback)
    const mode: RegenerateMode = requestedMode === 'full' ? 'full' : 'operations'

    // Validation: Required fields
    if (!planId || !userMessage) {
      return NextResponse.json(
        { error: 'Missing required fields: planId, userMessage' },
        { status: 400 }
      )
    }

    // Validation: planId must be a number
    const planIdNum = typeof planId === 'number' ? planId : parseInt(planId, 10)
    if (isNaN(planIdNum) || planIdNum <= 0) {
      return NextResponse.json({ error: 'Invalid planId' }, { status: 400 })
    }

    // Validation: userMessage must be non-empty after trim
    const trimmedMessage = userMessage.trim()
    if (trimmedMessage.length === 0) {
      return NextResponse.json({ error: 'Message cannot be empty' }, { status: 400 })
    }

    // Validation: Message length limit (prevent token overflow)
    if (trimmedMessage.length > 2000) {
      return NextResponse.json(
        { error: 'Message too long (max 2000 characters)' },
        { status: 400 }
      )
    }

    console.log(`[Regenerate] Plan ${planIdNum} - Mode: ${mode} - Request: "${trimmedMessage}"`)

    // Load full plan context (pass authenticated supabase client)
    console.log(`[Regenerate] Loading plan context...`)
    const planContext = await loadFullPlanContext(planIdNum, supabase)
    console.log(
      `[Regenerate] Loaded plan: ${planContext.plan.name} (${planContext.weeks.length} weeks)`
    )

    // Get LLM provider and settings from user
    const { data: athlete } = await supabase
      .from('athletes')
      .select('preferred_llm_provider, use_fast_model_for_operations')
      .eq('id', user.id)
      .maybeSingle()

    const providerName = athlete?.preferred_llm_provider || 'deepseek'
    const useFastModel = athlete?.use_fast_model_for_operations ?? true
    console.log(`[Regenerate] Using LLM provider: ${providerName}`)

    // For operations mode with DeepSeek, use faster chat model if setting is enabled
    let modelOverride: string | undefined
    if (mode === 'operations' && providerName === 'deepseek' && useFastModel) {
      modelOverride = 'deepseek-chat'
      console.log(`[Regenerate] Using fast model: ${modelOverride} for operations mode`)
    }

    // Create LLM provider
    const provider = createLLMProvider(providerName, modelOverride)

    // ============================================================================
    // OPERATIONS MODE (Default)
    // ============================================================================
    if (mode === 'operations') {
      console.log(`[Regenerate] Using operations mode`)

      // Build operation prompt (much smaller than full regeneration)
      const { systemPrompt, userPrompt } = buildOperationPrompt({
        userMessage: trimmedMessage,
        planContext
      })

      // Estimate tokens (operations mode uses much fewer)
      const estimatedInputTokens = estimateTokens(systemPrompt + userPrompt)
      console.log(`[Regenerate] Estimated input tokens: ~${estimatedInputTokens}`)

      // Max tokens for operations response (small - just operations list)
      const maxTokens = 1000

      // Call LLM
      console.log(`[Regenerate] Calling LLM for operations...`)
      const llmStartTime = Date.now()

      const response = await provider.generateResponse({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        maxTokens,
        temperature: 0.2 // Lower temperature for consistent operations
      })

      const llmDuration = ((Date.now() - llmStartTime) / 1000).toFixed(2)
      console.log(`[Regenerate] LLM responded in ${llmDuration}s`)

      const llmResponse = response.content

      // Log response for debugging
      const timestamp = new Date().toISOString().replace(/:/g, '-')
      const logPath = join(process.cwd(), `llm-operations-${timestamp}.json`)
      try {
        writeFileSync(logPath, JSON.stringify({
          timestamp,
          mode: 'operations',
          provider: providerName,
          planId: planIdNum,
          userMessage: trimmedMessage,
          estimatedInputTokens,
          maxOutputTokens: maxTokens,
          generationTimeSeconds: parseFloat(llmDuration),
          systemPrompt,
          userPrompt,
          rawResponse: llmResponse
        }, null, 2))
        console.log(`[Regenerate] Logged response to ${logPath}`)
      } catch (err) {
        console.error('[Regenerate] Failed to write log file:', err)
      }

      // Parse operation response
      const parsed = parseOperationResponse(llmResponse)

      if (!parsed.success) {
        console.error('[Regenerate] Failed to parse operations:', parsed.error)
        console.error('[Regenerate] Raw LLM response:', llmResponse.substring(0, 500))
        return NextResponse.json(
          {
            error: 'Failed to parse LLM response',
            details: parsed.error,
            raw_response: llmResponse.substring(0, 1000)
          },
          { status: 500 }
        )
      }

      // Check for fallback request
      if (parsed.fallback) {
        console.log(`[Regenerate] LLM requested fallback: ${parsed.fallback.reason}`)
        return NextResponse.json({
          success: true,
          mode: 'fallback_required',
          reason: parsed.fallback.reason,
          estimated_time: '5-10 minutes',
          user_message: `This modification is complex and requires regenerating affected weeks. This typically takes 5-10 minutes with ${providerName}. Would you like to proceed?`
        })
      }

      // Validate operations
      const operations = parsed.operations || []
      console.log(`[Regenerate] Parsed ${operations.length} operations`)

      const validation = validateOperations(operations, planContext)
      if (!validation.valid) {
        console.warn('[Regenerate] Operation validation errors:', validation.errors)
      }
      if (validation.warnings.length > 0) {
        console.warn('[Regenerate] Operation validation warnings:', validation.warnings)
      }

      // Generate preview
      const previews = previewOperations(operations, planContext)

      // Get week_starts_on for day name conversion
      const weekStartsOn = planContext.athlete_constraints.week_starts_on ?? 0

      // Debug: Log operations before sending
      console.log(`[Regenerate] Sending ${operations.length} operations to UI:`,
        operations.map((op: any) => ({ op: op?.op, hasDescription: !!op })))

      // Return operations preview
      return NextResponse.json({
        success: true,
        mode: 'operations',
        preview: {
          summary: parsed.summary || 'Plan modifications',
          operations: operations.map((op: any) => ({
            ...op,
            description: describeOperation(op, weekStartsOn)
          })),
          affected_workouts: previews.flatMap(p => p.affectedWorkouts),
          validation: {
            valid: validation.valid,
            errors: validation.errors,
            warnings: validation.warnings
          },
          metadata: {
            llm_provider: providerName,
            llm_duration_seconds: parseFloat(llmDuration),
            estimated_input_tokens: estimatedInputTokens,
            operations_count: operations.length,
            week_starts_on: weekStartsOn
          }
        }
      })
    }

    // ============================================================================
    // FULL REGENERATION MODE (Fallback)
    // ============================================================================
    console.log(`[Regenerate] Using full regeneration mode`)

    // Extract workout references (W#:D#) for UI highlighting
    const workoutReferences = extractWorkoutReferences(trimmedMessage)
    if (workoutReferences.length > 0) {
      console.log(
        `[Regenerate] Detected workout references: ${workoutReferences.map(r => r.index).join(', ')}`
      )
    }

    // Build regeneration prompt
    const { systemPrompt, userPrompt } = buildRegenerationPrompt({
      userMessage: trimmedMessage,
      planContext,
      workoutReferences
    })

    // Estimate token usage
    const estimatedInputTokens = estimateTokens(systemPrompt + userPrompt)
    console.log(`[Regenerate] Estimated input tokens: ~${estimatedInputTokens}`)

    // Calculate max tokens for regeneration
    const maxTokens = calculateMaxTokens(
      estimatedInputTokens,
      providerName,
      'regeneration'
    )
    console.log(`[Regenerate] Max output tokens: ${maxTokens}`)

    // Call LLM for regeneration
    console.log(`[Regenerate] Calling LLM for full regeneration...`)
    const llmStartTime = Date.now()

    const response = await provider.generateResponse({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      maxTokens,
      temperature: 0.3 // Lower temperature for consistency
    })

    const llmDuration = ((Date.now() - llmStartTime) / 1000).toFixed(2)
    console.log(`[Regenerate] LLM responded in ${llmDuration}s`)

    const llmResponse = response.content

    // Log the FULL response to a file for debugging
    const timestamp = new Date().toISOString().replace(/:/g, '-')
    const logPath = join(process.cwd(), `llm-regenerate-${timestamp}.json`)
    try {
      writeFileSync(logPath, JSON.stringify({
        timestamp,
        mode: 'full',
        provider: providerName,
        planId: planIdNum,
        userMessage: trimmedMessage,
        estimatedInputTokens,
        maxOutputTokens: maxTokens,
        generationTimeSeconds: parseFloat(llmDuration),
        systemPrompt,
        userPrompt,
        rawResponse: llmResponse
      }, null, 2))
      console.log(`[Regenerate] Logged response to ${logPath}`)
    } catch (err) {
      console.error('[Regenerate] Failed to write log file:', err)
      // Continue execution even if logging fails
    }

    // Parse JSON response
    let parsedResponse: any
    try {
      // Try to extract JSON from response (in case LLM added text)
      const jsonMatch = llmResponse.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error('No JSON found in LLM response')
      }
      parsedResponse = JSON.parse(jsonMatch[0])
    } catch (parseError) {
      console.error('[Regenerate] Failed to parse LLM response:', llmResponse.substring(0, 500))
      return NextResponse.json(
        {
          error: 'Failed to parse LLM response',
          details: parseError instanceof Error ? parseError.message : 'Invalid JSON',
          raw_response: llmResponse.substring(0, 1000)
        },
        { status: 500 }
      )
    }

    // Validate structure
    if (
      !parsedResponse.intent_summary ||
      !parsedResponse.affected_weeks ||
      !parsedResponse.regenerated_weeks
    ) {
      return NextResponse.json(
        {
          error: 'Invalid LLM response structure',
          details: 'Missing required fields: intent_summary, affected_weeks, or regenerated_weeks'
        },
        { status: 500 }
      )
    }

    console.log(`[Regenerate] Intent: ${parsedResponse.intent_summary}`)
    console.log(
      `[Regenerate] Affected weeks: ${parsedResponse.affected_weeks.join(', ')} (${parsedResponse.regenerated_weeks.length} weeks)`
    )

    // Validate regenerated weeks against plan
    const validation = validateRegeneratedWeeks(
      parsedResponse.regenerated_weeks,
      planContext
    )

    if (!validation.valid) {
      console.warn('[Regenerate] Validation warnings:', validation.errors)
    }

    // Return preview (NOT applied to database yet)
    return NextResponse.json({
      success: true,
      mode: 'full',
      preview: {
        intent_summary: parsedResponse.intent_summary,
        affected_weeks: parsedResponse.affected_weeks,
        regenerated_weeks: parsedResponse.regenerated_weeks,
        validation: {
          valid: validation.valid,
          errors: validation.errors,
          formatted_errors: validation.errors.length > 0 ? formatValidationErrors(validation.errors) : null
        },
        metadata: {
          llm_provider: providerName,
          llm_duration_seconds: parseFloat(llmDuration),
          estimated_input_tokens: estimatedInputTokens,
          weeks_to_replace: parsedResponse.regenerated_weeks.length,
          workouts_to_create: parsedResponse.regenerated_weeks.reduce(
            (sum: number, week: any) => sum + week.workouts.length,
            0
          )
        }
      }
    })
  } catch (error) {
    console.error('[Regenerate] Error:', error)
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
