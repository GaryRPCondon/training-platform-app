import type { FullTemplate } from '@/lib/templates/types'
import type { UserCriteria } from '@/lib/templates/types'

export interface GenerationContext {
  template: FullTemplate
  criteria: UserCriteria
  goal_date: string
  start_date: string
}

/**
 * Build system prompt for LLM plan generation
 */
export function buildGenerationSystemPrompt(context: GenerationContext): string {
  const { template, criteria, start_date, goal_date } = context

  // Calculate actual days available
  const startDateObj = new Date(start_date)
  const goalDateObj = new Date(goal_date)
  const daysAvailable = Math.floor((goalDateObj.getTime() - startDateObj.getTime()) / (1000 * 60 * 60 * 24))
  const weeksNeeded = Math.ceil(daysAvailable / 7)

  // Calculate which day of the week each date falls on
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const startDayOfWeek = dayNames[startDateObj.getDay()]
  const raceDayOfWeek = dayNames[goalDateObj.getDay()]

  // Calculate which "day number" (1-7) the race should be
  // If start is Friday (day 5), week 1 day 1 = Friday
  // If race is Sunday, and start is Friday: Sunday is day 3 of a week starting Friday
  const raceDayNumber = ((goalDateObj.getDay() - startDateObj.getDay() + 7) % 7) + 1

  const templateWeeks = template.duration_weeks || 18

  return `You are a marathon training coach, specializing in the Hansons Marathon Method.

SELECTED TEMPLATE: ${template.name}
This template (normally ${templateWeeks} weeks) provides the training philosophy and workout structure to adapt.

USER TIMELINE - CRITICAL:
- Training start date: ${start_date} (${startDayOfWeek})
- Race date: ${goal_date} (${raceDayOfWeek})
- Days between start and race: ${daysAvailable} days
- Weeks needed: ${weeksNeeded} weeks
- IMPORTANT: The race is on a ${raceDayOfWeek}, which will be day ${raceDayNumber} of week ${weeksNeeded}

USER CONSTRAINTS:
- Current weekly mileage: ${criteria.current_weekly_mileage}km
- Maximum comfortable weekly mileage: ${criteria.comfortable_peak_mileage}km
- Training days per week: ${criteria.days_per_week}
- Experience level: ${criteria.experience_level}

TASK:
Generate a ${weeksNeeded}-week personalized training plan that:
1. Week 1, Day 1 starts on ${start_date} (${startDayOfWeek})
2. Week ${weeksNeeded}, Day ${raceDayNumber} is the marathon race on ${goal_date} (${raceDayOfWeek})
3. Adapts the Hansons training philosophy to fit this timeline
4. Includes ${weeksNeeded} total weeks

CRITICAL INSTRUCTIONS:
- You MUST generate EXACTLY ${weeksNeeded} weeks (not ${templateWeeks} weeks)
- Each week has EXACTLY 7 days (numbered 1-7)
- The marathon race MUST be: type="race_pace", on week ${weeksNeeded}, day ${raceDayNumber}
- This will make the race fall on ${goal_date} (${raceDayOfWeek})
- Do NOT put the race on day 1, day 7, or any other day - it MUST be day ${raceDayNumber} of week ${weeksNeeded}

KEY PRINCIPLES:
1. Follow the template's training philosophy throughout
2. Maintain the core workout structure and progression patterns
3. Adapt phase lengths proportionally to fit ${weeksNeeded} weeks
4. Respect the weekly mileage ceiling (${criteria.comfortable_peak_mileage}km)
5. Schedule workouts on ${criteria.days_per_week} days per week (rest days on others)
6. Build appropriately from current ${criteria.current_weekly_mileage}km base

WORKOUT INDEXING:
Every workout MUST have a unique index in the format: W{week}:D{day}
- Week numbers: 1 to ${weeksNeeded}
- Day numbers: ALWAYS 1 to 7 (there are ALWAYS exactly 7 days in each week)
- Week 1, Day 1 = ${start_date} (${startDayOfWeek})
- Week ${weeksNeeded}, Day ${raceDayNumber} = ${goal_date} (${raceDayOfWeek}) = RACE DAY
- Examples: W1:D1, W1:D7, W2:D1, W${weeksNeeded}:D${raceDayNumber}
- You MUST NOT create day 8, 9, 10, etc. - only days 1-7 exist per week

OUTPUT FORMAT:
Return a JSON object with this exact structure:
{
  "weeks": [
    {
      "week_number": 1,
      "phase": "base",
      "weekly_total_km": 35.0,
      "workouts": [
        {
          "day": 1,
          "workout_index": "W1:D1",
          "type": "easy_run",
          "description": "Easy aerobic run to start the plan",
          "distance_meters": 8000,
          "duration_minutes": 50,
          "intensity": "easy",
          "pace_guidance": "Conversational pace, heart rate zone 2",
          "notes": "Focus on form and comfort"
        }
      ]
    }
  ]
}

WORKOUT TYPES (use these consistently):
- easy_run
- long_run
- tempo_run
- intervals
- race_pace
- recovery_run
- cross_training
- rest

REQUIRED FIELDS per workout:
- day (1-7)
- workout_index (W#:D# format)
- type
- description
- distance_meters (or null for time-based workouts)
- duration_minutes (estimated)
- intensity (easy/moderate/hard/recovery)
- pace_guidance (descriptive)
- notes (optional coaching notes)

IMPORTANT:
- Generate EXACTLY ${weeksNeeded} weeks
- Week ${weeksNeeded}, Day ${raceDayNumber} MUST be the marathon race (type="race_pace")
- Do not truncate or summarize - output the complete ${weeksNeeded}-week plan
- Return ONLY the JSON object, no markdown formatting, no extra text
- Ensure the JSON is valid and complete (all brackets closed)`
}

/**
 * Build user message with full template data
 */
export function buildGenerationUserMessage(template: FullTemplate): string {
  // Convert template to clean JSON string
  const templateJson = JSON.stringify(template, null, 2)

  return `Here is the complete ${template.name} template to adapt:

${templateJson}

Please generate the personalized training plan following the system instructions.
Remember to:
1. Maintain the template's training philosophy
2. Adapt to the user's specific constraints
3. Use W#:D# indexing for all workouts
4. Place the race on the correct week and day number as specified
5. Return valid JSON only`
}

/**
 * Estimate token count for generation request
 */
export function estimateGenerationTokens(context: GenerationContext): number {
  const systemPrompt = buildGenerationSystemPrompt(context)
  const userMessage = buildGenerationUserMessage(context.template)

  // Rough estimate: 1 token ≈ 4 characters
  const totalChars = systemPrompt.length + userMessage.length
  return Math.ceil(totalChars / 4)
}
