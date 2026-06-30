import { differenceInCalendarDays, addDays, format } from 'date-fns'
import type { RaceDistance } from '@/lib/templates/types'
import { buildOutputContractSection } from '@/lib/plans/llm-prompts'
import type { ParsedRunningPlan } from '@/lib/plans/import/schemas'

export interface ImportedGenerationCriteria {
  current_weekly_mileage: number
  comfortable_peak_mileage: number
  days_per_week: number
  preferred_rest_days?: number[]
}

export interface ImportedGenerationContext {
  definition: ParsedRunningPlan
  criteria: ImportedGenerationCriteria
  goal_date: string
  start_date: string
  goal_type: RaceDistance
  first_day_of_week?: 0 | 1
  preferred_units: 'metric' | 'imperial'
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function getDistanceLabel(goalType: RaceDistance): string {
  switch (goalType) {
    case '5k': return '5K'
    case '10k': return '10K'
    case 'half_marathon': return 'half marathon'
    case 'marathon': return 'marathon'
    default: return String(goalType)
  }
}

function getNextDayOfWeek(date: Date, targetDay: number): Date {
  const result = new Date(date)
  const currentDay = date.getDay()
  const daysUntilTarget = targetDay === currentDay ? 0 : ((targetDay - currentDay + 7) % 7)
  result.setDate(date.getDate() + daysUntilTarget)
  return result
}

/**
 * Build the system prompt to schedule an imported plan: the source plan the
 * athlete owns is the guidance; the LLM tailors it to the athlete's volume,
 * training days, and timeline — mirroring template generation — then the user
 * reviews. Shares the OUTPUT contract with template generation so the produced
 * JSON matches what the parser / writePlanToDatabase expect.
 */
export function buildImportedGenerationSystemPrompt(context: ImportedGenerationContext): string {
  const { definition, criteria, start_date, goal_date, goal_type, first_day_of_week = 1, preferred_units } = context
  const distanceLabel = getDistanceLabel(goal_type)

  const startDateObj = new Date(start_date)
  const goalDateObj = new Date(goal_date)
  const planStartDate = getNextDayOfWeek(startDateObj, first_day_of_week)
  const partialDays = differenceInCalendarDays(planStartDate, startDateObj)
  const daysFromPlanStartToGoal = differenceInCalendarDays(goalDateObj, planStartDate)
  const weeksNeeded = Math.floor(daysFromPlanStartToGoal / 7) + 1

  const raceDayOfWeek = goalDateObj.getDay()
  const raceDayName = DAY_NAMES[raceDayOfWeek]
  const firstDayName = DAY_NAMES[first_day_of_week]
  const raceDayNumber = raceDayOfWeek === first_day_of_week ? 1 : ((raceDayOfWeek - first_day_of_week + 7) % 7) + 1

  const sourceWeeks = definition.weeks.length

  const preWeekSection = partialDays > 0 ? `
PARTIAL WEEK (Pre-Week):
Before the structured plan begins, generate ${partialDays} easy ramp-in runs for the days between ${format(startDateObj, 'MMM d')} and ${format(addDays(planStartDate, -1), 'MMM d')}:
- Type: easy_run, Intensity: easy (conversational)
- Keep these short and comfortable relative to the athlete's current mileage
- Format these in a separate "pre_week_workouts" array (see OUTPUT FORMAT section)
` : ''

  const restDaysLine = criteria.preferred_rest_days && criteria.preferred_rest_days.length > 0
    ? `\n- Preferred non-training days: ${criteria.preferred_rest_days.map(d => DAY_NAMES[d]).join(', ')}`
    : ''

  return `You are an expert running coach. The athlete OWNS the training plan below (imported from a book/app they own). Your job is to faithfully adapt its philosophy, weekly structure, workout types, and progression to THIS athlete's parameters and timeline — then they will review the result.

SOURCE PLAN: ${definition.name}
This plan is ${sourceWeeks} weeks as written${definition.distance ? ` (${definition.distance})` : ''}. It provides the workout structure, sequencing, and intent to preserve. The full plan is supplied in the user message.

USER TIMELINE - CRITICAL:
- Athlete selected start date: ${format(startDateObj, 'EEEE, MMMM d, yyyy')}
- Plan officially begins: ${format(planStartDate, 'EEEE, MMMM d, yyyy')} (Week 1, Day 1)${partialDays > 0 ? `\n- Partial days before plan: ${partialDays} days` : ''}
- Race date: ${format(goalDateObj, 'EEEE, MMMM d, yyyy')} (Week ${weeksNeeded}, Day ${raceDayNumber})
- Full weeks of structured training: ${weeksNeeded} weeks
${preWeekSection}
USER CONSTRAINTS:
- Current weekly mileage: ${criteria.current_weekly_mileage}km
- Maximum comfortable weekly mileage: ${criteria.comfortable_peak_mileage}km
- Training days per week: ${criteria.days_per_week}${restDaysLine}

TASK:
Generate a ${weeksNeeded}-week personalized plan that:
1. Week 1, Day 1 starts on ${format(planStartDate, 'EEEE, MMMM d')}
2. Week ${weeksNeeded}, Day ${raceDayNumber} is the ${distanceLabel} race on ${format(goalDateObj, 'EEEE, MMMM d')}
3. Follows the SOURCE PLAN's training philosophy, workout types, and progression
4. Is tailored to this athlete's volume, training days, and timeline

KEY PRINCIPLES:
1. Preserve the source plan's structure, key workouts, and weekly rhythm — this is the plan the athlete chose to follow.
2. If the source is ${sourceWeeks} weeks but the athlete has ${weeksNeeded}, compress or stretch it proportionally — drop the lowest-value weeks first (recovery/down weeks), and always protect the peak, taper, and race weeks.
3. TAILOR VOLUME to this athlete: anchor Week 1 at or near the athlete's current weekly mileage (${criteria.current_weekly_mileage}km) and build toward — but NEVER exceed — their comfortable peak (${criteria.comfortable_peak_mileage}km). Scale the source plan's weekly volumes to this range while keeping its relative shape (build/recovery pattern).
4. HARD VOLUME CEILING: No week may exceed ${criteria.comfortable_peak_mileage}km total — not even by 1km.
5. Schedule workouts on ${criteria.days_per_week} days per week (rest days on the others).${criteria.preferred_rest_days && criteria.preferred_rest_days.length > 0 ? `
6. MANDATORY: place rest days on ${criteria.preferred_rest_days.map(d => DAY_NAMES[d]).join(', ')}; move the source plan's workouts to accommodate this without creating consecutive hard days.` : ''}
7. Preserve any explicit paces the source plan specifies; otherwise leave pace to the athlete's training paces (the system fills these in).

MEASUREMENT UNITS:
- Athlete's preferred unit system: ${preferred_units === 'imperial' ? 'Imperial (miles)' : 'Metric (km)'}
- distance_meters fields are ALWAYS in meters regardless of preference
- description field: "${preferred_units === 'imperial' ? 'Easy 8 mi. (13 km)' : 'Easy 13 km'}" style for continuous runs; miles for interval rep distances, metres for short recoveries and sub-mile track reps

${buildOutputContractSection({
  weeksNeeded,
  firstDayName,
  raceDayNumber,
  raceDayName,
  distanceLabel,
  partialDays,
  isTimeBased: false,
  planStartDate,
  goalDateObj,
  template: { pace_targets: undefined },
  goal_type,
})}`
}

/**
 * User message carrying the full imported plan definition to adapt.
 */
export function buildImportedGenerationUserMessage(definition: ParsedRunningPlan): string {
  const json = JSON.stringify(definition, null, 2)
  return `Here is the complete plan the athlete owns and wants to follow, as a normalized JSON definition (weeks in ascending training order, workouts per day with type, description, distances, intensity, and any explicit pace_literal):

${json}

Please generate the personalized ${definition.weeks.length > 0 ? '' : ''}training plan following the system instructions:
1. Preserve this plan's philosophy, workout types, and progression
2. Tailor volume and training days to the athlete's constraints
3. Fit it to the athlete's exact week count and place the race on the specified week/day
4. Use W#:D# indexing for all workouts
5. Return valid JSON only`
}
