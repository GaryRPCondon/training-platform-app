import type { FullTemplate } from '@/lib/templates/types'
import type { UserCriteria } from '@/lib/templates/types'
import { differenceInCalendarDays, addDays, format } from 'date-fns'

export interface GenerationContext {
  template: FullTemplate
  criteria: UserCriteria
  goal_date: string
  start_date: string
  first_day_of_week?: 0 | 1  // 0=Sunday, 1=Monday
  preferred_units: 'metric' | 'imperial'
}

/**
 * Get next occurrence of a specific day of week
 */
function getNextDayOfWeek(date: Date, targetDay: number): Date {
  const result = new Date(date)
  const currentDay = date.getDay()
  const daysUntilTarget = targetDay === currentDay ? 0 :
    ((targetDay - currentDay + 7) % 7)
  result.setDate(date.getDate() + daysUntilTarget)
  return result
}

/**
 * Build system prompt for LLM plan generation
 */
export function buildGenerationSystemPrompt(context: GenerationContext): string {
  const { template, criteria, start_date, goal_date, first_day_of_week = 1, preferred_units } = context

  const startDateObj = new Date(start_date)
  const goalDateObj = new Date(goal_date)

  // Calculate when the structured plan officially begins (next Monday/Sunday)
  const planStartDate = getNextDayOfWeek(startDateObj, first_day_of_week)

  // Calculate partial days between user's start date and plan start
  const partialDays = differenceInCalendarDays(planStartDate, startDateObj)

  // Calculate full weeks from plan start to goal
  const daysFromPlanStartToGoal = differenceInCalendarDays(goalDateObj, planStartDate)
  const weeksNeeded = Math.ceil(daysFromPlanStartToGoal / 7)

  // Calculate which day of the week the race falls on
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const raceDayOfWeek = goalDateObj.getDay()
  const raceDayName = dayNames[raceDayOfWeek]
  const firstDayName = dayNames[first_day_of_week]

  // Calculate which "day number" (1-7) the race should be in final week
  const raceDayNumber = raceDayOfWeek === first_day_of_week ? 1 :
    ((raceDayOfWeek - first_day_of_week + 7) % 7) + 1

  const templateWeeks = template.duration_weeks || 18

  // Build pre-week section if there are partial days
  const preWeekSection = partialDays > 0 ? `
PARTIAL WEEK (Pre-Week):
Before the structured plan begins, generate ${partialDays} easy ramp-in runs for the days between ${format(startDateObj, 'MMM d')} and ${format(addDays(planStartDate, -1), 'MMM d')}:
- Type: easy_run
- Intensity: easy (conversational pace)
- Purpose: Gentle ramp-in period before structured training begins
- Distance: Keep these short and comfortable (relative to athlete's current mileage)
- Format these in a separate "pre_week_workouts" array (see OUTPUT FORMAT section)
` : ''

  return `You are a marathon training coach, specializing in the template's training philosophy.

SELECTED TEMPLATE: ${template.name}
This template (normally ${templateWeeks} weeks) provides the training philosophy and workout structure to adapt.

USER TIMELINE - CRITICAL:
- Athlete selected start date: ${format(startDateObj, 'EEEE, MMMM d, yyyy')}
- Plan officially begins: ${format(planStartDate, 'EEEE, MMMM d, yyyy')} (Week 1, Day 1)${partialDays > 0 ? `\n- Partial days before plan: ${partialDays} days` : ''}
- Race date: ${format(goalDateObj, 'EEEE, MMMM d, yyyy')} (Week ${weeksNeeded}, Day ${raceDayNumber})
- Full weeks of structured training: ${weeksNeeded} weeks
${preWeekSection}

USER CONSTRAINTS:
- Current weekly mileage: ${criteria.current_weekly_mileage}km
- Maximum comfortable weekly mileage: ${criteria.comfortable_peak_mileage}km
- Training days per week: ${criteria.days_per_week}
- Experience level: ${criteria.experience_level}${criteria.preferred_rest_days && criteria.preferred_rest_days.length > 0 ? `
- Preferred non-training days: ${criteria.preferred_rest_days.map(d => dayNames[d]).join(', ')}` : ''}

MEASUREMENT UNITS:
- Athlete's preferred unit system: ${preferred_units === 'imperial' ? 'Imperial (miles)' : 'Metric (km)'}
- distance_meters field: ALWAYS in meters regardless of preference
- description field: follow the template's dual-unit style for continuous runs, mile-based for intervals
  - Continuous runs: "Easy 8 mi. (13 km)", "Tempo 8 mi. (13 km)", "Long 16 mi. (27 km)"
  - Intervals: use miles for rep distances, metres for short recoveries — "6 × 1 mi., 400 recovery"
  - Sub-mile track distances always in metres: 400m, 800m, 1200m
  Scale distances to fit the athlete's load, but always use this style — never raw metre conversions like "4828m"
- pace_guidance field: use min/km for metric, min/mile for imperial

TASK:
Generate a ${weeksNeeded}-week personalized training plan that:
1. Week 1, Day 1 starts on ${format(planStartDate, 'EEEE, MMMM d')}
2. Week ${weeksNeeded}, Day ${raceDayNumber} is the marathon race on ${format(goalDateObj, 'EEEE, MMMM d')}
3. Adapts the template's training philosophy to fit this timeline
4. Includes ${weeksNeeded} full weeks${partialDays > 0 ? ` PLUS ${partialDays} pre-week ramp-in runs` : ''}

CRITICAL INSTRUCTIONS:
- Generate EXACTLY ${weeksNeeded} full weeks (Week 1 through Week ${weeksNeeded})
- Week 1, Day 1 starts on ${firstDayName}, ${format(planStartDate, 'MMMM d')}
- The marathon race MUST be on Week ${weeksNeeded}, Day ${raceDayNumber} (${raceDayName}, ${format(goalDateObj, 'MMMM d')})
- Each week has EXACTLY 7 days (numbered 1-7, starting with ${firstDayName})
- Do NOT create day 8, 9, 10, etc. - only days 1-7 exist per week${partialDays > 0 ? `
- Generate ${partialDays} pre-week workouts in the "pre_week_workouts" array before the "weeks" array` : ''}

KEY PRINCIPLES:
1. Follow the template's training philosophy throughout
2. Maintain the core workout structure and progression patterns
3. Adapt phase lengths proportionally to fit ${weeksNeeded} weeks
4. HARD VOLUME CEILING: No week may exceed ${criteria.comfortable_peak_mileage}km total — not even by 1km
5. WEEK 1 ANCHOR: Week 1 total must be at or below the athlete's current weekly mileage (${criteria.current_weekly_mileage}km). Never start higher than where the athlete is now.
6. Schedule workouts on ${criteria.days_per_week} days per week (rest days on others)${criteria.preferred_rest_days && criteria.preferred_rest_days.length > 0 ? `
7. MANDATORY: Schedule rest days on: ${criteria.preferred_rest_days.map(d => dayNames[d]).join(', ')}
   - These are the athlete's REQUIRED non-training days
   - You MUST place rest days on these specific days of the week
   - Adjust the template's workout schedule to accommodate this requirement
   - The athlete's schedule preferences override the template's default rest day placement
8. Build progressively from the Week 1 base toward the peak, following the template's volume curve` : `
7. Build progressively from the Week 1 base toward the peak, following the template's volume curve`}

⚠️  CRITICAL WORKOUT SCHEDULING RULE - ABSOLUTE REQUIREMENT ⚠️

YOU MUST NEVER PLACE HARD WORKOUTS ON CONSECUTIVE DAYS UNLESS THE TEMPLATE EXPLICITLY DOES THIS.

Hard workouts are defined as:
- type: "long_run"
- type: "intervals"
- type: "tempo"
- ANY workout with intensity: "hard" or intensity: "moderate"

ABSOLUTE REQUIREMENTS - NO EXCEPTIONS:
1. CHECK THE TEMPLATE: Does the template place hard workouts on back-to-back days?
   - YES → Preserve that exact pattern (e.g., Saturday tempo + Sunday long run)
   - NO → You MUST separate all hard workouts with rest/easy_run/recovery days

2. BEFORE ASSIGNING ANY WORKOUT:
   - Look at the PREVIOUS day's workout (even across week boundaries)
   - If previous day was hard, THIS day MUST be rest/easy_run/recovery
   - If this day will be hard, PREVIOUS day MUST have been rest/easy_run/recovery

3. CROSS-WEEK BOUNDARIES:
   - Week 2 Monday depends on Week 1 Sunday
   - Week 3 Monday depends on Week 2 Sunday
   - And so on...

4. WHEN ADAPTING FOR REST DAY PREFERENCES:
   - Moving workouts to accommodate rest days is ONLY allowed if it doesn't create consecutive hard days
   - If rest day preference forces consecutive hard days, move the HARD workout to a different day instead

VERIFICATION CHECKLIST - CHECK EVERY WEEK:
□ Day 1: If hard, was Day 7 of previous week easy/rest/recovery?
□ Day 2: If hard, was Day 1 easy/rest/recovery?
□ Day 3: If hard, was Day 2 easy/rest/recovery?
□ Day 4: If hard, was Day 3 easy/rest/recovery?
□ Day 5: If hard, was Day 4 easy/rest/recovery?
□ Day 6: If hard, was Day 5 easy/rest/recovery?
□ Day 7: If hard, was Day 6 easy/rest/recovery?

CORRECT PATTERNS:
✓ Monday (intervals) → Tuesday (easy_run) → Wednesday (tempo)
✓ Sunday (long_run) → Monday (rest) → Tuesday (intervals)
✓ Saturday (easy) → Sunday (long_run) → Monday (recovery)
✓ Template has consecutive hard days → Keep them consecutive

ABSOLUTELY FORBIDDEN PATTERNS:
✗ Tuesday (intervals) → Wednesday (tempo)  ← THIS IS WRONG
✗ Sunday (long_run) → Monday (intervals)   ← THIS IS WRONG
✗ Thursday (tempo) → Friday (long_run)     ← THIS IS WRONG

WORKOUT INDEXING:
Every workout in the structured weeks MUST have a unique index in the format: W{week}:D{day}
- Week numbers: 1 to ${weeksNeeded}
- Day numbers: ALWAYS 1 to 7 (all weeks start on ${firstDayName})
- Week 1, Day 1 = ${format(planStartDate, 'MMM d')} (${firstDayName})
- Week ${weeksNeeded}, Day ${raceDayNumber} = ${format(goalDateObj, 'MMM d')} (${raceDayName}) = RACE DAY
- Examples: W1:D1, W1:D7, W2:D1, W${weeksNeeded}:D${raceDayNumber}
- You MUST NOT create day 8, 9, 10, etc. - only days 1-7 exist per week

OUTPUT FORMAT:
Return a JSON object with this structure:
{${partialDays > 0 ? `
  "pre_week_workouts": [
    {
      "type": "easy_run",
      "distance_km": 8.0,
      "intensity": "easy",
      "description": "Easy ramp-in run",
      "pace_guidance": "Conversational pace",
      "notes": "Focus on comfort and building routine"
    }
  ],` : ''}
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
          "intensity": "easy",
          "pace_guidance": "Conversational pace, heart rate zone 2",
          "notes": "Focus on form and comfort"
        }
      ]
    }
  ]
}

WORKOUT TYPES (use ONLY these exact types):
- easy_run (for standard easy/aerobic runs)
- recovery (for recovery runs - very easy, day after hard workouts)
- long_run (for long runs)
- tempo (for tempo runs and race pace efforts)
- intervals (for speed/interval workouts)
- rest (for rest days)
- cross_training (for cross-training activities)
- race (for goal race day - marathon, half marathon, 10K, 5K, ultra, etc.)

CRITICAL INSTRUCTION - DISTANCE-BASED PRESCRIPTIONS:
All marathon training templates prescribe DISTANCE + INTENSITY only.
The athlete determines their own pace based on fitness level (VDOT).
DO NOT calculate or include duration_minutes - the system calculates this automatically based on athlete's training paces.

REQUIRED FIELDS per workout:
- day (1-7)
- workout_index (W#:D# format)
- type (easy_run/recovery/long_run/tempo/intervals/rest/cross_training)
- description (human-readable label including distance in the athlete's preferred units. Format: "{Type} {distance} {unit}" for continuous runs. For intervals: "{N} × {distance} with {recovery}")
- distance_meters (required for running workouts, null for rest/cross-training)
- intensity (easy/moderate/marathon/hard/recovery)
  Use "marathon" for marathon-pace tempo workouts (e.g. Hanson's)
- pace_guidance (descriptive guidance: "conversational pace", "comfortably hard", "5K race pace", etc.)
- notes (optional coaching notes)
- structured_workout (intervals only — see STRUCTURED WORKOUT below)

STRUCTURED WORKOUT:
Only include "structured_workout" for type "intervals". Provide only "main_set":
  "structured_workout": {
    "main_set": [
      { "repeat": N, "intervals": [
        { "distance_meters": XXXXX, "intensity": "hard" },
        { "distance_meters": XXXXX, "intensity": "recovery" }
      ]}
    ]
  }
For all other types (easy_run, recovery, long_run, tempo, rest, cross_training, race):
Omit "structured_workout" entirely — the server generates it automatically.

EXAMPLE — intervals: Template says "Strength: 3 × 2 mi., 800 recovery"
{
  "type": "intervals",
  "description": "Strength: 3 × 2 mi., 800 recovery",
  "distance_meters": 16000,
  "intensity": "hard",
  "pace_guidance": "Intervals at 10K effort. Recovery jog at very easy pace.",
  "notes": "Focus on consistent effort across all repetitions",
  "structured_workout": {
    "main_set": [
      { "repeat": 3, "intervals": [
        { "distance_meters": 3219, "intensity": "hard" },
        { "distance_meters": 800, "intensity": "recovery" }
      ]}
    ]
  }
}

DO NOT INCLUDE:
- duration_minutes (system calculates from distance + athlete's pace)
- duration_seconds (system calculates from distance + athlete's pace)
- Any time-based targets (the template prescribes distance only)

IMPORTANT:
- Generate EXACTLY ${weeksNeeded} weeks
- Week ${weeksNeeded}, Day ${raceDayNumber} MUST be the race day (type="race", description="Marathon Race Day")
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
