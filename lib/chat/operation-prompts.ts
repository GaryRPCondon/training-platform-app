/**
 * Operation Prompts for Phase 5 Chat Refinement
 *
 * OPERATION-BASED ARCHITECTURE:
 * Instead of having the LLM regenerate complete weeks (brittle, ~20k tokens),
 * this prompt asks the LLM to output discrete operations (~200 tokens).
 *
 * Benefits:
 * - Much smaller token usage
 * - Original data preserved automatically
 * - Deterministic execution by code
 * - LLM focuses on understanding intent, not data preservation
 */

import type { FullPlanContext } from './plan-context-loader'

/**
 * Operation request for LLM
 */
export interface OperationRequest {
  /** User's modification request in natural language */
  userMessage: string
  /** Full plan context for understanding current state */
  planContext: FullPlanContext
}

/**
 * Build prompt for operation extraction
 *
 * @param request - Operation request with user message and plan context
 * @returns System and user prompts for LLM
 */
export function buildOperationPrompt(request: OperationRequest): {
  systemPrompt: string
  userPrompt: string
} {
  const systemPrompt = buildOperationSystemPrompt()
  const userPrompt = buildOperationUserPrompt(request)

  return { systemPrompt, userPrompt }
}

/**
 * System prompt for operation extraction using tool calling
 */
function buildOperationSystemPrompt(): string {
  return `You are a training plan modification assistant. Your job is to translate natural language requests into structured operation tool calls.

## Your Task

1. **Understand the user's request** - What do they want to change?
2. **Call operation tools** - Use the provided tools to express discrete, atomic changes
3. **Call request_fallback tool** if the change is too complex for operations

## Day Numbers

Days are numbered 1-7 based on the week start preference:
- If week starts Sunday: 1=Sun, 2=Mon, 3=Tue, 4=Wed, 5=Thu, 6=Fri, 7=Sat
- If week starts Monday: 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat, 7=Sun

The current plan's week start is shown in the context.

## Common Translations

| User Request | Tool Calls |
|--------------|------------|
| "Move rest days to Saturday" | move_workout_type(workoutType="rest", toDay=6, weekNumbers="all") |
| "Put long runs on Sundays" | move_workout_type(workoutType="long_run", toDay=7, weekNumbers="all") |
| "Remove W14:D4" | change_workout_type(workoutIndex="W14:D4", newType="rest") |
| "Change W14:D6 to a 10 mile race" | change_workout_type(workoutIndex="W14:D6", newType="race") + change_workout_distance(workoutIndex="W14:D6", newDistanceMeters=16093) |
| "Make week 5 easier" | scale_week_volume(weekNumber=5, factor=0.8) |
| "Swap Monday and Friday" | swap_days(weekNumbers="all", dayA=1, dayB=5) |
| "Reduce taper week volume" | scale_phase_volume(phaseName="Taper", factor=0.7) |

## When to Use request_fallback

Use request_fallback for requests that:
- Require adding or removing workouts (changing days per week)
- Need complex interdependent changes across weeks
- Require rewriting workout descriptions or structures
- Ask for completely different training approaches

## Rules

1. **Use the fewest tool calls** - Multiple operations can be combined
2. **Preserve original data** - Operations modify specific fields only
3. **Use "all" for week ranges** when the user wants changes everywhere
4. **Call request_fallback if unsure** - It's better to fall back than produce wrong operations`
}

/**
 * Build user prompt with plan context (condensed for token efficiency)
 */
function buildOperationUserPrompt(request: OperationRequest): string {
  const { userMessage, planContext } = request

  let prompt = ''

  // Plan overview (condensed)
  prompt += `## Current Plan\n\n`
  prompt += `**Plan**: ${planContext.plan.name}\n`
  prompt += `**Weeks**: ${planContext.weeks.length}\n`
  prompt += `**Days per Week**: ${planContext.athlete_constraints.days_per_week || 7}\n`
  prompt += `**Phases**: ${planContext.phases.map(p => p.phase_name).join(', ')}\n\n`

  // Week start (important for day number interpretation)
  const weekStartDay = planContext.athlete_constraints.week_starts_on ?? 0
  const weekStart = weekStartDay === 0 ? 'Sunday' :
                    weekStartDay === 1 ? 'Monday' :
                    weekStartDay === 6 ? 'Saturday' :
                    'Monday' // fallback for other values
  prompt += `**Week Starts On**: ${weekStart}\n\n`

  // Workout types in use (so LLM knows exact type names)
  const workoutTypes = new Set<string>()
  for (const week of planContext.weeks) {
    for (const workout of week.workouts) {
      workoutTypes.add(workout.workout_type)
    }
  }
  prompt += `**Workout Types Used**: ${Array.from(workoutTypes).join(', ')}\n\n`

  // Current week structure (sample first few weeks with dates)
  prompt += `## Week Structure Sample\n\n`
  const sampleWeeks = planContext.weeks.slice(0, 3) // Show first 3 weeks
  for (const week of sampleWeeks) {
    prompt += `**Week ${week.week_number}** (${week.phase_name}, starts ${week.week_start_date}):\n`
    for (const workout of week.workouts) {
      // Format date as "Mon, Mar 22" for readability
      const date = new Date(workout.scheduled_date)
      const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

      prompt += `  ${workout.workout_index} - ${dateStr}: ${workout.workout_type}`
      if (workout.distance_km) {
        prompt += ` (${workout.distance_km.toFixed(1)}km)`
      }
      prompt += `\n`
    }
    prompt += `\n`
  }

  if (planContext.weeks.length > 3) {
    prompt += `... and ${planContext.weeks.length - 3} more weeks with similar structure.\n\n`
  }

  // Add date range reference for the entire plan
  prompt += `**Plan Date Range**: ${planContext.plan.start_date} to ${planContext.plan.end_date}\n\n`

  // Add complete date-to-index mapping for date-based requests
  prompt += `## Date Reference (for date-based requests)\n\n`
  prompt += `When the user mentions a specific date, use this reference to find the workout index:\n\n`

  // Show all workouts with their dates grouped by week
  for (const week of planContext.weeks) {
    const workoutDates = week.workouts.map(w => {
      const date = new Date(w.scheduled_date)
      const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      return `${w.workout_index}=${dateStr}`
    }).join(', ')
    prompt += `Week ${week.week_number}: ${workoutDates}\n`
  }
  prompt += `\n`

  // Phase breakdown
  prompt += `## Phase Breakdown\n\n`
  for (const phase of planContext.phases) {
    const phaseWeeks = planContext.weeks.filter(w => w.phase_name === phase.phase_name)
    prompt += `- **${phase.phase_name}**: Weeks ${phaseWeeks.map(w => w.week_number).join(', ')}\n`
  }
  prompt += `\n`

  // User request
  prompt += `## User Request\n\n`
  prompt += `"${userMessage}"\n\n`

  // Final instruction
  prompt += `---\n\n`
  prompt += `Analyze the request and return the appropriate JSON response (operations or fallback).`

  return prompt
}

/**
 * Note: parseOperationResponse has been removed.
 *
 * We now use tool calling (function calling) which guarantees structured output
 * across all LLM providers. Operations come back as toolCalls[] with guaranteed
 * schema compliance, eliminating the need for JSON parsing and normalization.
 *
 * See:
 * - lib/plans/operation-tools.ts for tool definitions
 * - lib/agent/provider-interface.ts for ToolCall interface
 * - app/api/plans/regenerate/route.ts for usage
 */
