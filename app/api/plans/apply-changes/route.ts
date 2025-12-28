/**
 * /api/plans/apply-changes - Phase 5 Chat Refinement
 *
 * Endpoint for applying approved plan modifications to the database.
 *
 * DUAL MODE SUPPORT:
 *
 * Mode: "operations" (new, preferred)
 * - Applies discrete operations using applyOperations()
 * - Fast, deterministic, preserves original data
 *
 * Mode: "full" (legacy fallback)
 * - Replaces entire weeks using replaceWeeksInPlan()
 * - Used when operations can't express the change
 *
 * Request format:
 * - Operations mode: { planId, operations: [...] }
 * - Full mode: { planId, regeneratedWeeks: [...] }
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { loadFullPlanContext } from '@/lib/chat/plan-context-loader'
import {
  replaceWeeksInPlan,
  validateWeeksForReplacement,
  type RegeneratedWeek
} from '@/lib/chat/plan-replacer'
import {
  applyOperations,
  validateOperations,
  type PlanOperation
} from '@/lib/plans/operations'

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
    const { planId, operations, regeneratedWeeks } = body

    // Determine mode based on request body
    const isOperationsMode = Array.isArray(operations) && operations.length > 0
    const isFullMode = Array.isArray(regeneratedWeeks) && regeneratedWeeks.length > 0

    if (!planId) {
      return NextResponse.json(
        { error: 'Missing required field: planId' },
        { status: 400 }
      )
    }

    if (!isOperationsMode && !isFullMode) {
      return NextResponse.json(
        { error: 'Missing required field: operations (array) or regeneratedWeeks (array)' },
        { status: 400 }
      )
    }

    // Verify plan ownership
    const { data: plan, error: planError } = await supabase
      .from('training_plans')
      .select('id, name, status')
      .eq('id', planId)
      .eq('athlete_id', user.id)
      .maybeSingle()

    if (planError || !plan) {
      return NextResponse.json(
        { error: 'Plan not found or access denied' },
        { status: 404 }
      )
    }

    // Prevent modifications to completed plans
    if (plan.status === 'completed') {
      return NextResponse.json(
        { error: 'Cannot modify completed plan' },
        { status: 400 }
      )
    }

    // Load full plan context for validation
    console.log(`[ApplyChanges] Loading plan context...`)
    const planContext = await loadFullPlanContext(planId, supabase)

    // ============================================================================
    // OPERATIONS MODE
    // ============================================================================
    if (isOperationsMode) {
      console.log(
        `[ApplyChanges] Plan ${planId} - Applying ${operations.length} operations`
      )

      // Validate operations
      const validation = validateOperations(operations as PlanOperation[], planContext)
      if (!validation.valid) {
        console.error('[ApplyChanges] Operation validation failed:', validation.errors)
        return NextResponse.json(
          {
            error: 'Validation failed',
            validation_errors: validation.errors
          },
          { status: 400 }
        )
      }

      // Apply operations
      console.log(`[ApplyChanges] Applying operations to database...`)
      const startTime = Date.now()

      const result = await applyOperations(
        planId,
        operations as PlanOperation[],
        planContext,
        supabase
      )

      const duration = ((Date.now() - startTime) / 1000).toFixed(2)

      if (!result.success) {
        console.error('[ApplyChanges] Operations failed:', result.errors)
        return NextResponse.json(
          {
            error: 'Failed to apply operations',
            details: result.errors,
            partial_success: result.operationsApplied > 0,
            operations_applied: result.operationsApplied,
            workouts_modified: result.workoutsModified
          },
          { status: 500 }
        )
      }

      console.log(
        `[ApplyChanges] Success - Applied ${result.operationsApplied} operations, ` +
          `modified ${result.workoutsModified} workouts in ${duration}s`
      )

      return NextResponse.json({
        success: true,
        mode: 'operations',
        operations_applied: result.operationsApplied,
        workouts_modified: result.workoutsModified,
        duration_seconds: parseFloat(duration),
        message: `Successfully applied ${result.operationsApplied} operation${result.operationsApplied > 1 ? 's' : ''} to "${plan.name}"`
      })
    }

    // ============================================================================
    // FULL REGENERATION MODE (Fallback)
    // ============================================================================
    console.log(
      `[ApplyChanges] Plan ${planId} - Applying ${regeneratedWeeks.length} regenerated weeks`
    )

    // Validate regenerated weeks
    console.log(`[ApplyChanges] Validating regenerated weeks...`)
    const validation = validateWeeksForReplacement(
      regeneratedWeeks as RegeneratedWeek[],
      planContext
    )

    if (!validation.valid) {
      console.error('[ApplyChanges] Validation failed:', validation.errors)
      return NextResponse.json(
        {
          error: 'Validation failed',
          validation_errors: validation.errors
        },
        { status: 400 }
      )
    }

    // Apply changes to database
    console.log(`[ApplyChanges] Replacing weeks in database...`)
    const startTime = Date.now()

    const result = await replaceWeeksInPlan(
      planId,
      regeneratedWeeks as RegeneratedWeek[],
      planContext
    )

    const duration = ((Date.now() - startTime) / 1000).toFixed(2)

    if (!result.success) {
      console.error('[ApplyChanges] Replacement failed:', result.errors)
      return NextResponse.json(
        {
          error: 'Failed to apply changes',
          details: result.errors,
          partial_success: result.weeks_replaced > 0,
          weeks_replaced: result.weeks_replaced,
          workouts_created: result.workouts_created
        },
        { status: 500 }
      )
    }

    console.log(
      `[ApplyChanges] Success - Replaced ${result.weeks_replaced} weeks, ` +
        `created ${result.workouts_created} workouts in ${duration}s`
    )

    return NextResponse.json({
      success: true,
      mode: 'full',
      weeks_replaced: result.weeks_replaced,
      workouts_created: result.workouts_created,
      duration_seconds: parseFloat(duration),
      message: `Successfully updated ${result.weeks_replaced} week${result.weeks_replaced > 1 ? 's' : ''} in "${plan.name}"`
    })
  } catch (error) {
    console.error('[ApplyChanges] Error:', error)
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
