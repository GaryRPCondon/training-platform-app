/**
 * Regeneration Prompts for Phase 5 Chat Refinement
 *
 * LLM-ONLY ARCHITECTURE:
 * This module builds prompts that instruct the LLM to handle BOTH:
 * 1. Intent understanding (parsing user's natural language request)
 * 2. Plan regeneration (creating modified weeks based on that intent)
 
 */

import type { FullPlanContext } from './plan-context-loader'
import { formatContextForLLM } from './plan-context-loader'

/**
 * Regeneration request from user
 */
export interface RegenerationRequest {
  /** User's modification request in natural language */
  userMessage: string
  /** Full plan context for regeneration */
  planContext: FullPlanContext
  /** Optional: Pre-extracted workout references (W#:D#) for validation */
  workoutReferences?: Array<{ week: number; day: number; index: string }>
}

/**
 * Build complete prompt for LLM-based plan regeneration
 *
 * @param request - Regeneration request with user message and plan context
 * @returns Complete prompt for LLM (system + user message)
 */
export function buildRegenerationPrompt(request: RegenerationRequest): {
  systemPrompt: string
  userPrompt: string
} {
  const systemPrompt = buildSystemPrompt()
  const userPrompt = buildUserPrompt(request)

  return { systemPrompt, userPrompt }
}

/**
 * Build system prompt with instructions for intent understanding + regeneration
 *
 * SIMPLIFIED: The original template is the authoritative reference for training
 * methodology. This prompt just provides task structure and output format.
 */
function buildSystemPrompt(): string {
  return `You are an AI training plan modification assistant.

## Your Task

1. **Parse User Intent** - Understand the modification request in natural language
2. **Identify Affected Weeks** - Determine which weeks need modification
3. **Modify Weeks** - Adjust the CURRENT PLAN while preserving its structure (same number of workouts, similar volume)
4. **Return JSON** - Output structured JSON with modified weeks

## Critical Rules (MUST FOLLOW)

- **PRESERVE current plan structure**: Keep the SAME number of workouts per week as the current plan (if plan has 7 workouts/week, output 7 workouts/week)
- **ADJUST, don't recreate**: You're modifying an existing plan, not creating a new one. Make minimal changes to achieve the user's request.
- **Maintain weekly volumes**: Keep weekly distances similar to current plan unless user specifically requests volume changes
- **NO consecutive hard workouts**: Hard workouts (tempo, intervals, long_run, speed, race) must ALWAYS have easy/rest days between them. NEVER place two hard workouts on consecutive days.
- **Preserve workout types and distances**: Unless user requests changes, keep the same workout types and distances, just rearrange the schedule
- **Intensity targets only**: Specify intensity_target (easy, threshold, etc.) - pace calculations are done automatically

## Workout Types
Use the EXACT workout_type values from the current plan. Common types include:
- rest, recovery, easy, easy_run, long_run, progression, tempo, intervals, speed, race

CRITICAL: If the current plan uses "easy_run", use "easy_run" (not "easy").

## Intent Examples

- "Move all rest days to Fridays" → Modify ALL weeks, swap rest day to day 5 (keep EXACT workout descriptions, types, distances for all other workouts)
- "Make week 5 easier" → Modify week 5, reduce distances by ~20% (keep EXACT descriptions like "Tempo run: 45 minutes")
- "Change W4:D2 to 12km tempo" → Modify week 4 day 2 only, change to tempo workout
- "Put long runs on Saturdays" → Modify weeks with long runs, move long_run to day 6 (preserve EXACT description like "Long run: First 20-miler")

## Output Format (JSON ONLY)

CRITICAL: The workouts array length MUST EXACTLY MATCH the current plan's workout count per week.
(If current plan has 7 workouts/week, you MUST output 7 workouts/week. If it has 6, output 6.)

Example for a week with 7 workouts:

\`\`\`json
{
  "intent_summary": "Brief description of changes made",
  "affected_weeks": [4, 5, 6],
  "regenerated_weeks": [
    {
      "week_number": 4,
      "phase_name": "Build",
      "weekly_volume_km": 65.0,
      "workouts": [
        {
          "day": 1,
          "workout_type": "easy",
          "description": "Easy run",
          "distance_km": 10.0,
          "intensity_target": "easy"
        },
        {
          "day": 2,
          "workout_type": "tempo",
          "description": "Tempo run",
          "distance_km": 12.0,
          "intensity_target": "threshold"
        },
        {
          "day": 3,
          "workout_type": "easy",
          "description": "Recovery run",
          "distance_km": 8.0,
          "intensity_target": "easy"
        },
        {
          "day": 4,
          "workout_type": "intervals",
          "description": "5 x 1km at 5k pace",
          "distance_km": 10.0,
          "intensity_target": "interval"
        },
        {
          "day": 5,
          "workout_type": "easy",
          "description": "Easy run",
          "distance_km": 10.0,
          "intensity_target": "easy"
        },
        {
          "day": 6,
          "workout_type": "tempo",
          "description": "Marathon pace run",
          "distance_km": 12.0,
          "intensity_target": "threshold"
        },
        {
          "day": 7,
          "workout_type": "long_run",
          "description": "Long run",
          "distance_km": 20.0,
          "intensity_target": "easy"
        }
      ]
    }
  ]
}
\`\`\`

Note: This example shows 7 workouts (matching a 7-day plan). Hard workouts (tempo on day 2, intervals on day 4, tempo on day 6, long_run on day 7) are separated by easy/rest days.

**Field Requirements:**
- \`intent_summary\`: 1-2 sentence description
- \`affected_weeks\`: Array of week numbers
- \`regenerated_weeks\`: Array of week objects (contains the modified weeks)
  - \`week_number\`: Integer (1 to total weeks)
  - \`phase_name\`: Exact phase name from plan
  - \`weekly_volume_km\`: Total km (sum of workout distances, should be similar to current plan)
  - \`workouts\`: Array of workout objects (**CRITICAL: array length MUST match the current plan's workout count for that week**)
    - \`day\`: Integer 1-7 (the day number within the week)
    - \`workout_type\`: rest, recovery, easy, long_run, progression, tempo, intervals, speed, race
    - \`description\`: Human-readable workout detail (e.g., "8 x 800m with 400m recovery")
    - \`distance_km\`: Number or null (null for rest)
    - \`intensity_target\`: recovery, easy, moderate, threshold, interval, repetition
    - **Note**: Pace guidance is calculated automatically based on VDOT and intensity_target

**VALIDATION CHECKLIST** (verify before returning):
1. Does workouts.length match the CURRENT PLAN's workout count for each week? (preserve existing structure)
2. Are hard workouts (tempo, intervals, long_run, speed, race) separated by easy/rest days? (no consecutive hard days)
3. Do all phase_name values match the original plan exactly?
4. Are weekly volumes similar to the current plan (unless user requested volume changes)?

Return ONLY the JSON object. No explanatory text before or after.`
}

/**
 * Format original template for LLM context
 *
 * Shows the template structure, workout patterns, and progression approach.
 * This becomes the authoritative reference for regeneration.
 */
function formatOriginalTemplate(template: FullPlanContext['template']): string {
  let output = `**Template**: ${template.name}\n`
  output += `**Author**: ${template.author}\n`
  output += `**Methodology**: ${template.methodology}\n`
  output += `**Duration**: ${template.duration_weeks} weeks\n`
  output += `**Training Days**: ${template.training_days_per_week} days/week\n`
  if (template.peak_weekly_mileage?.km) {
    output += `**Peak Mileage**: ${template.peak_weekly_mileage.km}km/week\n`
  }
  output += `\n`

  // Philosophy
  if (template.philosophy?.approach) {
    output += `**Training Philosophy**: ${template.philosophy.approach}\n`
  }
  if (template.philosophy?.key_features && template.philosophy.key_features.length > 0) {
    output += `**Key Features**:\n`
    template.philosophy.key_features.forEach(feature => {
      output += `- ${feature}\n`
    })
  }
  output += `\n`

  // Week-by-week structure
  if (template.weekly_schedule && Array.isArray(template.weekly_schedule) && template.weekly_schedule.length > 0) {
    output += `**Week-by-Week Structure**:\n\n`
    for (const weekSched of template.weekly_schedule) {
      if (!weekSched) continue

      output += `**Week ${weekSched.week || '?'}**${weekSched.phase ? ` (${weekSched.phase})` : ''}\n`

      // Handle different template formats
      if (weekSched.workouts) {
        // Hal Higdon / Jack Daniels format (workouts object)
        Object.entries(weekSched.workouts).forEach(([day, workout]) => {
          if (!workout || typeof workout !== 'object') return
          output += `  ${day}: ${workout.type || 'workout'}`
          if (workout.distance?.km) {
            output += ` - ${workout.distance.km}km`
          }
          if (workout.description) {
            output += ` (${workout.description})`
          }
          output += `\n`
        })
      } else {
        // Pfitzinger / Hansons / Magness format (day properties)
        const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
        days.forEach(day => {
          const workout = weekSched[day as keyof typeof weekSched]
          if (workout && typeof workout === 'string') {
            output += `  ${day}: ${workout}\n`
          }
        })
      }

      if (weekSched.weekly_total?.km) {
        output += `  Weekly total: ${weekSched.weekly_total.km}km\n`
      }
      output += `\n`
    }
  }

  return output
}

/**
 * Build user prompt with plan context and modification request
 *
 * NEW STRUCTURE (MODIFICATION-FOCUSED):
 * 1. Current plan state (primary reference - what to modify)
 * 2. User's modification request (what to change)
 * 3. Original template (optional reference for workout types/philosophy)
 */
function buildUserPrompt(request: RegenerationRequest): string {
  const { userMessage, planContext, workoutReferences } = request

  let prompt = ''

  // 1. Current plan state (PRIMARY REFERENCE)
  prompt += `## Current Plan (Your Primary Reference)\n\n`
  prompt += `This is the plan you are MODIFYING. Preserve its structure unless the user explicitly requests changes.\n\n`
  prompt += formatContextForLLM(planContext)
  prompt += `\n---\n\n`

  // 2. Workout references hint if detected
  if (workoutReferences && workoutReferences.length > 0) {
    const refList = workoutReferences.map(r => r.index).join(', ')
    prompt += `## Detected Workout References\n\n`
    prompt += `The user mentioned these specific workouts: ${refList}\n\n`
  }

  // 3. User's modification request
  prompt += `## User's Modification Request\n\n`
  prompt += `${userMessage}\n\n`
  prompt += `---\n\n`

  // 4. Original template (optional reference)
  prompt += `## Original Template (Optional Reference)\n\n`
  prompt += `This template was used to create the plan. Use it for reference on workout types and training philosophy, ` +
            `but DO NOT use it to determine workout counts - use the current plan's structure instead.\n\n`
  prompt += formatOriginalTemplate(planContext.template)
  prompt += `\n---\n\n`

  // 5. Final instruction
  prompt += `**Instructions**: Modify the affected weeks from the current plan to match the user's request. ` +
            `Preserve the current plan's structure (same number of workouts per week, similar volumes). ` +
            `Make MINIMAL changes - only adjust what the user explicitly requested.\n\n`
  prompt += `**CRITICAL PRESERVATION RULES** - DO NOT SIMPLIFY OR CHANGE ANYTHING UNLESS EXPLICITLY REQUESTED:\n` +
            `1. Each week must have the SAME number of workouts as it currently has in the plan above\n` +
            `2. Use the EXACT workout_type values from the current plan (e.g., if current uses "easy_run", use "easy_run" not "easy")\n` +
            `3. Keep the EXACT description wording - DO NOT simplify (e.g., "Long run: First 20-miler" must stay "Long run: First 20-miler", NOT "Long run")\n` +
            `4. Keep the EXACT distance_km values unless the workout is being modified\n` +
            `5. Keep the EXACT intensity_target values from the current plan\n` +
            `6. Ensure NO consecutive hard workouts\n` +
            `7. When moving a workout to a different day, copy ALL its fields exactly (type, description, distance, intensity)\n\n`
  prompt += `Verify your response against the validation checklist.\n\n`
  prompt += `Return ONLY the JSON response as specified in the system prompt.`

  return prompt
}

/**
 * Validate regenerated weeks against original plan
 *
 * Basic sanity checks before applying changes to database:
 * - Week numbers are valid
 * - Phase names match
 * - Number of workouts per week is correct
 * - No invalid workout types
 * - No consecutive hard workouts
 *
 * @param regeneratedWeeks - Weeks from LLM response
 * @param planContext - Original plan context
 * @returns Validation result with errors if any
 */
export function validateRegeneratedWeeks(
  regeneratedWeeks: any[],
  planContext: FullPlanContext
): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  const validWorkoutTypes = [
    'rest',
    'recovery',
    'easy',
    'easy_run',  // Added - common in plans
    'long_run',
    'progression',
    'tempo',
    'intervals',
    'speed',
    'race',
    'cross_training'  // Added for completeness
  ]

  const hardWorkoutTypes = ['tempo', 'intervals', 'speed', 'race', 'long_run']

  for (const week of regeneratedWeeks) {
    // Validate week number
    if (week.week_number < 1 || week.week_number > planContext.weeks.length) {
      errors.push(`Week ${week.week_number} is out of range`)
      continue
    }

    // Find original week
    const originalWeek = planContext.weeks.find(w => w.week_number === week.week_number)
    if (!originalWeek) {
      errors.push(`Week ${week.week_number} not found in original plan`)
      continue
    }

    // Validate phase name matches
    if (week.phase_name !== originalWeek.phase_name) {
      errors.push(
        `Week ${week.week_number} phase mismatch: got "${week.phase_name}", expected "${originalWeek.phase_name}"`
      )
    }

    // Validate workout count matches current plan
    const expectedWorkouts = originalWeek.workouts.length
    if (week.workouts.length !== expectedWorkouts) {
      errors.push(
        `Week ${week.week_number} has ${week.workouts.length} workouts, but current plan has ${expectedWorkouts}. Must preserve workout count.`
      )
    }

    // Validate workout types and consecutive hard workouts
    let previousWasHard = false
    for (let i = 0; i < week.workouts.length; i++) {
      const workout = week.workouts[i]

      // Check valid workout type
      if (!validWorkoutTypes.includes(workout.workout_type)) {
        errors.push(
          `Week ${week.week_number}, Day ${workout.day}: Invalid workout type "${workout.workout_type}"`
        )
      }

      // Check consecutive hard workouts
      const isHard = hardWorkoutTypes.includes(workout.workout_type)
      if (isHard && previousWasHard) {
        errors.push(
          `Week ${week.week_number}, Day ${workout.day}: Consecutive hard workouts detected`
        )
      }
      previousWasHard = isHard

      // Validate day number
      if (workout.day < 1 || workout.day > 7) {
        errors.push(`Week ${week.week_number}: Invalid day number ${workout.day}`)
      }

      // Validate rest day has no distance
      if (workout.workout_type === 'rest' && workout.distance_km !== null) {
        errors.push(`Week ${week.week_number}, Day ${workout.day}: Rest day should have null distance`)
      }
    }

    // Validate weekly volume is reasonable (within 50% of original)
    const volumeDiff = Math.abs(week.weekly_volume_km - originalWeek.weekly_volume_km)
    const volumeRatio = volumeDiff / originalWeek.weekly_volume_km
    if (volumeRatio > 0.5 && originalWeek.weekly_volume_km > 0) {
      errors.push(
        `Week ${week.week_number}: Weekly volume changed by ${(volumeRatio * 100).toFixed(0)}% ` +
          `(${originalWeek.weekly_volume_km.toFixed(1)}km → ${week.weekly_volume_km.toFixed(1)}km). ` +
          `This may be intentional, but seems like a large change.`
      )
    }
  }

  return {
    valid: errors.length === 0,
    errors
  }
}

/**
 * Format validation errors for user display
 *
 * @param errors - Array of validation error messages
 * @returns User-friendly error message
 */
export function formatValidationErrors(errors: string[]): string {
  if (errors.length === 0) return ''

  let message = `Found ${errors.length} validation issue${errors.length > 1 ? 's' : ''}:\n\n`
  errors.forEach((err, i) => {
    message += `${i + 1}. ${err}\n`
  })
  message += `\nPlease review the regenerated plan before applying.`

  return message
}
