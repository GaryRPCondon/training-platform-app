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
 * System prompt for operation extraction
 */
function buildOperationSystemPrompt(): string {
  return `You are a training plan modification assistant. Your job is to translate natural language requests into structured operations.

## Your Task

1. **Understand the user's request** - What do they want to change?
2. **Output operations** - Discrete, atomic changes that code will apply
3. **Request fallback** if the change is too complex for operations

## Available Operations

### Schedule Changes (Bulk)
Use these for patterns across multiple weeks:
\`\`\`json
{ "op": "swap_days", "weekNumbers": [1,2,3] | "all", "dayA": 1, "dayB": 6 }
{ "op": "move_workout_type", "workoutType": "long_run", "toDay": 6, "weekNumbers": [1,2,3] | "all" }
\`\`\`

### Workout Modifications (Specific Workouts)
Use workout indices (e.g., "W14:D6") when user references specific workouts:
\`\`\`json
{ "op": "reschedule_workout", "workoutIndex": "W14:D6", "newDate": "2025-01-15" }
{ "op": "change_workout_type", "workoutIndex": "W14:D4", "newType": "rest" }
{ "op": "change_workout_distance", "workoutIndex": "W14:D6", "newDistanceMeters": 16093 }
{ "op": "scale_workout_distance", "workoutIndex": "W5:D3", "factor": 0.8 }
\`\`\`

### Bulk Operations
Use these to modify multiple workouts by type or week:
\`\`\`json
{ "op": "remove_workout_type", "workoutType": "speed", "replacement": "easy", "weekNumbers": [14] }
{ "op": "scale_week_volume", "weekNumber": 5, "factor": 0.8 }
{ "op": "scale_phase_volume", "phaseName": "Taper", "factor": 0.7 }
\`\`\`

## Day Numbers

Days are numbered 1-7 based on the week start preference:
- If week starts Sunday: 1=Sun, 2=Mon, 3=Tue, 4=Wed, 5=Thu, 6=Fri, 7=Sat
- If week starts Monday: 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat, 7=Sun

The current plan's week start is shown in the context.

## Common Translations

| User Request | Operations |
|--------------|------------|
| "Move rest days to Saturday" | \`{ "op": "move_workout_type", "workoutType": "rest", "toDay": 6, "weekNumbers": "all" }\` |
| "Put long runs on Sundays" | \`{ "op": "move_workout_type", "workoutType": "long_run", "toDay": 7, "weekNumbers": "all" }\` |
| "Remove W14:D4" | \`{ "op": "change_workout_type", "workoutIndex": "W14:D4", "newType": "rest" }\` |
| "Change W14:D6 to a 10 mile race" | \`{ "op": "change_workout_type", "workoutIndex": "W14:D6", "newType": "race" }\`, \`{ "op": "change_workout_distance", "workoutIndex": "W14:D6", "newDistanceMeters": 16093 }\` |
| "Make week 5 easier" | \`{ "op": "scale_week_volume", "weekNumber": 5, "factor": 0.8 }\` |
| "Swap Monday and Friday" | \`{ "op": "swap_days", "weekNumbers": "all", "dayA": 1, "dayB": 5 }\` |
| "Reduce taper week volume" | \`{ "op": "scale_phase_volume", "phaseName": "Taper", "factor": 0.7 }\` |

## Output Format

Return a JSON object with either operations OR a fallback request:

### Success (Operations)
\`\`\`json
{
  "operations": [
    { "op": "move_workout_type", "workoutType": "rest", "toDay": 6, "weekNumbers": "all" },
    { "op": "move_workout_type", "workoutType": "long_run", "toDay": 7, "weekNumbers": "all" }
  ],
  "summary": "Moving rest days to Saturday and long runs to Sunday across all weeks"
}
\`\`\`

### Fallback (Complex Request)
\`\`\`json
{
  "fallback": true,
  "reason": "This request requires restructuring workout sequences that cannot be expressed as simple operations. Full plan regeneration is needed."
}
\`\`\`

## When to Fallback

Use fallback for requests that:
- Require adding or removing workouts (changing days per week)
- Need complex interdependent changes across weeks
- Require rewriting workout descriptions or structures
- Ask for completely different training approaches

## Rules

1. **Use the fewest operations** - Combine when possible
2. **Preserve original data** - Operations modify specific fields only
3. **Use "all" for week ranges** when the user wants changes everywhere
4. **Fallback if unsure** - It's better to fall back than produce wrong operations

Return ONLY the JSON object. No explanatory text.`
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

  // Current week structure (sample first few weeks)
  prompt += `## Week Structure Sample\n\n`
  const sampleWeeks = planContext.weeks.slice(0, 3) // Show first 3 weeks
  for (const week of sampleWeeks) {
    prompt += `**Week ${week.week_number}** (${week.phase_name}):\n`
    for (const workout of week.workouts) {
      prompt += `  Day ${workout.day}: ${workout.workout_type}`
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
 * Parse LLM response for operations
 *
 * @param response - Raw LLM response
 * @returns Parsed operations or fallback request
 */
export function parseOperationResponse(response: string): {
  success: boolean
  operations?: any[]
  summary?: string
  fallback?: { reason: string }
  error?: string
} {
  try {
    // Extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return { success: false, error: 'No JSON found in response' }
    }

    const parsed = JSON.parse(jsonMatch[0])

    // Debug: Log what LLM returned
    console.log('[parseOperationResponse] Parsed LLM response:', JSON.stringify(parsed, null, 2))

    // Check for fallback
    if (parsed.fallback === true) {
      return {
        success: true,
        fallback: { reason: parsed.reason || 'Complex request requires full regeneration' }
      }
    }

    // Handle Gemini returning singular "operation" instead of "operations" array
    let operations = parsed.operations
    if (!operations && parsed.operation) {
      console.log('[parseOperationResponse] Gemini returned singular "operation", wrapping in array')
      operations = [parsed.operation]
    }

    // Check for operations
    if (Array.isArray(operations)) {
      // Normalize operations (handle different LLM formats)
      const normalizedOps = operations.map((op: any, idx: number) => {
        if (!op || typeof op !== 'object') {
          console.error(`[parseOperationResponse] Operation ${idx} is not an object:`, op)
          return null
        }

        // If already in correct format, return as-is
        if (op.op && typeof op.op === 'string') {
          return op
        }

        // Handle Gemini's format (operation_type, week_index, day_index, etc.)
        if (op.operation_type === 'update_workout') {
          console.log(`[parseOperationResponse] Normalizing Gemini format for operation ${idx}`)

          const weekIndex = op.week_index || op.weekNumber
          const dayIndex = op.day_index || op.dayNumber
          const workoutIndex = `W${weekIndex}:D${dayIndex}`

          const normalized: any[] = []

          // Change type if specified
          if (op.workout_type) {
            // Generate appropriate description and intensity for the workout type
            let description = op.workout_type
            let intensity = 'easy'

            if (op.workout_type === 'race') {
              const distanceMiles = op.distance_km ? (op.distance_km / 1.60934).toFixed(1) : ''
              description = distanceMiles ? `${distanceMiles} mile race` : 'Race'
              intensity = 'hard'
            } else if (op.workout_type === 'long_run') {
              description = 'Long run'
              intensity = 'moderate'
            } else if (op.workout_type === 'tempo') {
              description = 'Tempo run'
              intensity = 'hard'
            } else if (op.workout_type === 'intervals' || op.workout_type === 'speed') {
              description = 'Interval training'
              intensity = 'hard'
            } else if (op.workout_type === 'easy_run' || op.workout_type === 'easy') {
              description = 'Easy run'
              intensity = 'easy'
            } else if (op.workout_type === 'rest' || op.workout_type === 'recovery') {
              description = 'Rest day'
              intensity = 'easy'
            }

            // Add change_intensity operation to update intensity_target
            normalized.push({
              op: 'change_intensity',
              workoutIndex,
              newIntensity: intensity
            })

            normalized.push({
              op: 'change_workout_type',
              workoutIndex,
              newType: op.workout_type,
              newDescription: description
            })
          }

          // Change distance if specified
          if (op.distance_km) {
            normalized.push({
              op: 'change_workout_distance',
              workoutIndex,
              newDistanceMeters: Math.round(op.distance_km * 1000)
            })
          }

          // Change date if specified
          if (op.scheduled_date || op.newDate) {
            normalized.push({
              op: 'reschedule_workout',
              workoutIndex,
              newDate: op.scheduled_date || op.newDate
            })
          }

          return normalized
        }

        console.error(`[parseOperationResponse] Operation ${idx} missing 'op' field and cannot normalize:`, op)
        return null
      })

      // Flatten (in case we expanded Gemini ops) and filter nulls
      const validOps = normalizedOps.flat().filter((op: any) => op !== null)

      if (validOps.length === 0) {
        return {
          success: false,
          error: `No valid operations found. Full response: ${JSON.stringify(parsed).substring(0, 500)}`
        }
      }

      console.log(`[parseOperationResponse] Normalized ${parsed.operations.length} operations to ${validOps.length} operations`)

      return {
        success: true,
        operations: validOps,
        summary: parsed.summary || 'Plan modifications'
      }
    }

    return { success: false, error: 'Invalid response format' }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to parse response'
    }
  }
}

/**
 * Estimate token count for operation prompt
 * (Much smaller than full regeneration prompt)
 */
export function estimateOperationTokens(request: OperationRequest): number {
  // System prompt is ~1000 tokens
  // User prompt is ~200-400 tokens (condensed context)
  // Total: ~1200-1400 tokens input
  // Expected output: ~50-200 tokens (just operations)
  return 1500
}
