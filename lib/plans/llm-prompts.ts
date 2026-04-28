import type { FullTemplate, RaceDistance } from '@/lib/templates/types'
import type { UserCriteria } from '@/lib/templates/types'
import { differenceInCalendarDays, addDays, format } from 'date-fns'

export interface GenerationContext {
  template: FullTemplate
  criteria: UserCriteria
  goal_date: string
  start_date: string
  goal_type: RaceDistance
  first_day_of_week?: 0 | 1  // 0=Sunday, 1=Monday
  preferred_units: 'metric' | 'imperial'
  isTimeBased?: boolean  // true when template prescribes workouts by time, not distance (e.g. run/walk)
}

/**
 * Get human-readable label for a race distance
 */
function getDistanceLabel(goalType: RaceDistance): string {
  switch (goalType) {
    case '5k': return '5K'
    case '10k': return '10K'
    case 'half_marathon': return 'half marathon'
    case 'marathon': return 'marathon'
  }
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
  const { template, criteria, start_date, goal_date, goal_type, first_day_of_week = 1, preferred_units, isTimeBased } = context
  const distanceLabel = getDistanceLabel(goal_type)

  const startDateObj = new Date(start_date)
  const goalDateObj = new Date(goal_date)

  // Calculate when the structured plan officially begins (next Monday/Sunday)
  const planStartDate = getNextDayOfWeek(startDateObj, first_day_of_week)

  // Calculate partial days between user's start date and plan start
  const partialDays = differenceInCalendarDays(planStartDate, startDateObj)

  // Calculate full weeks from plan start to goal.
  // The race falls on week `floor(days/7) + 1` because day 0 = W1D1, day 7 = W2D1, etc.
  // Using Math.ceil here previously produced W9 for 63 days (Mon→Mon), which collapses
  // the race into the final training week and misdates it by 7 days.
  const daysFromPlanStartToGoal = differenceInCalendarDays(goalDateObj, planStartDate)
  const weeksNeeded = Math.floor(daysFromPlanStartToGoal / 7) + 1

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

  // Build race-week guidance section from template (optional — falls back to POST-RACE RULE)
  const raceWeek = template.race_week
  const shakeoutSuffix = raceWeek?.shakeout_distance_meters
    ? ` (~${raceWeek.shakeout_distance_meters}m shakeout at easy pace)`
    : ''
  const volumeLine = raceWeek?.volume_pct_of_peak
    ? `\n- Total race-week volume: approximately ${raceWeek.volume_pct_of_peak}% of the peak training week`
    : ''
  const raceWeekSection = raceWeek ? `
RACE WEEK GUIDANCE (Week ${weeksNeeded} — from template):
- Day before race (Week ${weeksNeeded}, Day ${raceDayNumber - 1 > 0 ? raceDayNumber - 1 : 7}): ${raceWeek.day_before_race}${shakeoutSuffix}${volumeLine}
- ${raceWeek.guidance}
- No workouts, cross-training, or runs after the race on Day ${raceDayNumber} — every later day MUST be type=rest.

Apply these rules to Week ${weeksNeeded}. They override the template's generic weekly_schedule when compression forces deviation.
` : ''

  // Per-week prescribed workouts — only emit when template provides plan_week + total_km
  // (currently used by JD 2Q templates). For each week we list the specific workouts
  // the template author prescribes, including concrete per-day easy volumes from
  // E_days_distribution. The LLM maps these onto the calendar — it does NOT
  // compute or distribute mileage itself.
  const perWeekRows = (template.weekly_schedule ?? [])
    .filter(w => typeof w.plan_week === 'number' && typeof w.total_km === 'number')
    .sort((a, b) => (a.plan_week ?? 0) - (b.plan_week ?? 0))
  const longRunCap = template.validation_ranges?.long_run?.max
  const hasPerDay = perWeekRows.some(w => Array.isArray(w.E_days_distribution) && w.E_days_distribution.length > 0)
  const perWeekTargetsSection = perWeekRows.length > 0 ? (hasPerDay ? `
PER-WEEK PRESCRIBED WORKOUTS (binding — from template author):
For each week, generate exactly these workouts — no more, no less. Map them onto the calendar using the template's typical_week pattern and the user's rest-day preferences. Do NOT add mileage. Do NOT replace easy slots with quality work. Use the Q1/Q2 description verbatim for those workouts; use the prescribed type (in parentheses) as the workout's type field verbatim; use type=easy_run for each easy slot.

For each Q-slot, the tags after the type indicate:
- [SESSION]: emit a structured_workout with main_set covering the prescribed work. Echo "is_session": true on the workout.
- (no [SESSION] tag): do NOT emit a structured_workout. Echo "is_session": false.
- [W/C: included]: the description's leading/trailing easy segments (e.g. "6E + 6M + 2E") ARE the warmup/cooldown. Build main_set to cover the FULL description including those easy segments, and OMIT separate warmup/cooldown fields. Echo "warmup_cooldown": "included".
- [W/C: add]: the description prescribes only the main work (e.g. "6 × 1mi T w/1min jog"). Wrap with separate warmup + cooldown fields around main_set. Echo "warmup_cooldown": "add".
${perWeekRows.map(w => {
  const lines: string[] = []
  const frac = w.fraction_of_peak !== undefined ? `, fraction of peak ${w.fraction_of_peak}` : ''
  const totalMi = (w.Q1_mileage ?? 0) + (w.Q2_mileage ?? 0) + (w.E_days_total ?? 0)
  const totalLabel = totalMi > 0 ? `${totalMi} mi. (${w.total_km} km)` : `${w.total_km} km`
  lines.push(`\nWeek ${w.plan_week} (total ${totalLabel}${frac}):`)
  const tagsFor = (isSession?: boolean, wc?: 'included' | 'add'): string => {
    const parts: string[] = []
    if (isSession === true) parts.push('SESSION')
    if (wc) parts.push(`W/C: ${wc}`)
    return parts.length > 0 ? ` [${parts.join(', ')}]` : ''
  }
  if (w.Q1 && w.Q1_km !== undefined) {
    const t = w.Q1_type ? ` (${w.Q1_type})` : ''
    const dist = w.Q1_mileage !== undefined ? `${w.Q1_mileage} mi. (${w.Q1_km} km)` : `${w.Q1_km} km`
    lines.push(`  - Q1${t}${tagsFor(w.Q1_is_session, w.Q1_warmup_cooldown)}: ${dist} — "${w.Q1}"`)
  }
  if (w.Q2 && w.Q2_km !== undefined) {
    const t = w.Q2_type ? ` (${w.Q2_type})` : ''
    const dist = w.Q2_mileage !== undefined ? `${w.Q2_mileage} mi. (${w.Q2_km} km)` : `${w.Q2_km} km`
    lines.push(`  - Q2${t}${tagsFor(w.Q2_is_session, w.Q2_warmup_cooldown)}: ${dist} — "${w.Q2}"`)
  }
  for (const e of w.E_days_distribution ?? []) {
    const notes = e.notes ? ` — ${e.notes}` : ''
    const dist = e.mileage !== undefined ? `${e.mileage} mi. (${e.km} km)` : `${e.km} km`
    lines.push(`  - Easy: ${dist}${notes}`)
  }
  const qCount = (w.Q1 ? 1 : 0) + (w.Q2 ? 1 : 0)
  const eCount = (w.E_days_distribution ?? []).length
  const restDays = Math.max(0, 7 - qCount - eCount)
  for (let i = 0; i < restDays; i++) lines.push(`  - Rest`)
  return lines.join('\n')
}).join('\n')}
${longRunCap ? `
- No long_run's distance_meters may exceed ${longRunCap} (= ${(longRunCap/1000).toFixed(0)}km), regardless of the template's verbal Q1/Q2 description.` : ''}
` : `
PER-WEEK TARGETS (binding — from template):
plan_week | total_km${perWeekRows[0].Q1_km !== undefined ? ' | Q1_km | Q2_km' : ''}
${perWeekRows.map(w => {
  const q = w.Q1_km !== undefined ? ` | ${w.Q1_km ?? '—'} | ${w.Q2_km ?? '—'}` : ''
  return `W${w.plan_week} | ${w.total_km}${q}`
}).join('\n')}

- Each generated week's weekly_total_km MUST be within ±10% of the template's total_km for the matching plan_week.${longRunCap ? `
- No long_run's distance_meters may exceed ${longRunCap} (= ${(longRunCap/1000).toFixed(0)}km), regardless of the template's verbal Q1/Q2 description.` : ''}
`) : ''

  return `You are a ${distanceLabel} training coach, specializing in the template's training philosophy.

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
2. Week ${weeksNeeded}, Day ${raceDayNumber} is the ${distanceLabel} race on ${format(goalDateObj, 'EEEE, MMMM d')}
3. Adapts the template's training philosophy to fit this timeline
4. Includes ${weeksNeeded} full weeks${partialDays > 0 ? ` PLUS ${partialDays} pre-week ramp-in runs` : ''}

CRITICAL INSTRUCTIONS:
- Generate EXACTLY ${weeksNeeded} full weeks (Week 1 through Week ${weeksNeeded})
- Week 1, Day 1 starts on ${firstDayName}, ${format(planStartDate, 'MMMM d')}
- The ${distanceLabel} race MUST be on Week ${weeksNeeded}, Day ${raceDayNumber} (${raceDayName}, ${format(goalDateObj, 'MMMM d')})
- Each week has EXACTLY 7 days (numbered 1-7, starting with ${firstDayName})
- Do NOT create day 8, 9, 10, etc. - only days 1-7 exist per week${raceWeek ? '' : `
- POST-RACE RULE: In the final week (Week ${weeksNeeded}), every day AFTER Day ${raceDayNumber} MUST be type=rest. Do NOT schedule any runs, cross-training, or other workouts after the race.`}${partialDays > 0 ? `
- Generate ${partialDays} pre-week workouts in the "pre_week_workouts" array before the "weeks" array` : ''}
${raceWeekSection}${perWeekTargetsSection}

KEY PRINCIPLES:
1. Follow the template's training philosophy throughout
2. Maintain the core workout structure and progression patterns
3. Adapt phase lengths proportionally to fit ${weeksNeeded} weeks
4. HARD VOLUME CEILING: No week may exceed ${criteria.comfortable_peak_mileage}km total — not even by 1km
5. WEEK 1 ANCHOR: Week 1 total must match the template's plan_week=1 total_km if the template provides it (athlete is already at that volume). Otherwise start at or below the athlete's current weekly mileage (${criteria.current_weekly_mileage}km).
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
- ANY workout with intensity that is NOT easy/recovery (e.g. "hard", "moderate", "strength", "speed", "tempo", "marathon_pace", "vo2max", "lactate_threshold")

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

${isTimeBased ? `CRITICAL INSTRUCTION - TIME-BASED PRESCRIPTIONS:
This template prescribes workouts by TIME (duration), not distance.
Use duration_seconds for interval steps inside structured_workout.
The system estimates distances from duration + athlete's pace — do NOT convert time to distance yourself.

For workouts that are run/walk INTERVALS (alternating run and walk segments):
- Use type "intervals"
- Provide "structured_workout" with "warmup" and "main_set" (see STRUCTURED WORKOUT below)
- Set top-level "distance_meters" to a rough estimate for the total session:
  Beginner pace: ~130-150m/min running, ~100m/min walking. Multiply by total session minutes.

For workouts that are CONTINUOUS RUNNING (no walk breaks, e.g. "25 min running"):
- Use type "easy_run" (NOT intervals)
- Estimate distance_meters from the duration at beginner pace (~130-150m/min)
- Include "structured_workout" with warmup walk and a single main_set entry for the run
- Put the full time description in the "description" field

` : `CRITICAL INSTRUCTION - DISTANCE-BASED PRESCRIPTIONS:
Most workouts in this template prescribe DISTANCE + INTENSITY only.
The athlete determines their own pace based on fitness level (VDOT).
DO NOT calculate or include duration_minutes - the system calculates this automatically based on athlete's training paces.

EXCEPTION — TIME-PRESCRIBED WORKOUTS:
Some workouts in the template are prescribed by TIME, not distance. Examples include:
- Quality sessions: "LT 20min", "Hill Sprints 6x10sec", "Strength Endurance Hill Circuit", fartlek with timed efforts
- Long easy runs by time: "90 min run", "70 min run", "steady E run of 210 min"
- Walks or shakeouts by time: "30-60 min walk"
For these workouts:
- Set distance_meters to null (NOT 0)
- Add duration_seconds at the top level (total session duration in seconds, excluding warmup/cooldown)
- Include "structured_workout" with duration_seconds (not distance_meters) in interval steps
The system estimates distance from duration + athlete's pace — do NOT convert time to distance yourself.
NEVER output distance_meters: 0 — use null when a workout has no meaningful distance.

`}REQUIRED FIELDS per workout:
- day (1-7)
- workout_index (W#:D# format)
- type (easy_run/recovery/long_run/tempo/intervals/rest/cross_training)
- description (human-readable label${isTimeBased ? ` — use the template's time-based format (e.g. "5 min warm-up walk, then alternate 1 min running / 1.5 min walking for 20 min")` : ` including distance in the athlete's preferred units. Format: "{Type} {distance} {unit}" for continuous runs. For intervals: "{N} × {distance} with {recovery}"`})
- distance_meters (${isTimeBased ? 'estimated total session distance for running workouts, null for rest/cross-training' : 'required for distance-based running workouts, null for time-prescribed quality sessions, null for rest/cross-training'})
${isTimeBased ? '' : '- duration_seconds (only for workouts prescribed by time — e.g. "LT 20min" → 1200, "Hill Sprints 6x10sec" → 60. Omit for distance-based workouts.)'}
- intensity: Use one of these methodology-specific labels:
${template.pace_targets
  ? Object.entries(template.pace_targets).map(([key, target]) =>
    `  "${key}" — ${(target as { description: string }).description}`).join('\n')
  : goal_type === 'marathon'
    ? '  "easy", "moderate", "marathon", "hard", "recovery"\n  Use "marathon" for marathon-pace tempo workouts (e.g. Hanson\'s)'
    : '  "easy", "moderate", "race", "hard", "recovery"\n  Use "race" for race-pace tempo workouts'}
- pace_guidance (descriptive guidance: "conversational pace", "comfortably hard", "5K race pace", etc.)
- notes (optional coaching notes)
- structured_workout (intervals and continuous runs with warm-up walk — see STRUCTURED WORKOUT below)

${!isTimeBased && template.pace_targets && Object.values(template.pace_targets).some(t => (t as { prescription?: string }).prescription === 'time') ? `TIME-PRESCRIBED INTENSITIES (from template):
The following intensities in this template are prescribed by TIME, not distance:
${Object.entries(template.pace_targets)
  .filter(([, t]) => (t as { prescription?: string }).prescription === 'time')
  .map(([key, t]) => `- "${key}" — ${(t as { description: string }).description}`)
  .join('\n')}

When a workout uses one of these intensities, emit:
  "type": "easy_run" | "tempo" | etc,
  "intensity": "<intensity>",
  "distance_meters": null,
  "duration_seconds": <total session seconds>,
  "structured_workout": {
    "main_set": [
      { "repeat": 1, "intervals": [
        { "duration_seconds": <session seconds>, "intensity": "<intensity>" }
      ]}
    ]
  }
Example: Template says "30 min tempo" → duration_seconds: 1800, distance_meters: null.
Do NOT convert these time-prescribed intensities to distance.

` : ''}${isTimeBased ? `STRUCTURED WORKOUT (TIME-BASED):
Include "structured_workout" for type "intervals" AND for continuous runs with a warm-up walk.
Use "walk" intensity for all walking segments (warmup walks, walk breaks between runs).
This ensures Garmin does not apply running pace targets to walk segments.
  "structured_workout": {
    "warmup": { "duration_minutes": N, "intensity": "walk" },
    "main_set": [
      { "repeat": N, "intervals": [
        { "duration_seconds": XXXXX, "intensity": "easy" },
        { "duration_seconds": XXXXX, "intensity": "walk" }
      ]}
    ]
  }
- Use "duration_seconds" for interval steps (NOT distance_meters)
- Warmup: use the template's warm-up duration (e.g. 5 min for C25K)
- Cooldown: only include if the template specifies one — do NOT add one if the template omits it
- For non-uniform intervals (e.g. "5 min run, 3 min walk, 8 min run, 3 min walk"), use repeat: 1 with the full sequence:
  { "repeat": 1, "intervals": [
    { "duration_seconds": 300, "intensity": "easy" },
    { "duration_seconds": 180, "intensity": "walk" },
    { "duration_seconds": 480, "intensity": "easy" },
    { "duration_seconds": 180, "intensity": "walk" }
  ]}
For all other types (easy_run, recovery, long_run, tempo, rest, cross_training, race):
Omit "structured_workout" entirely — the server generates it automatically.

EXAMPLE — run/walk intervals: Template says "5 min warm-up walk, then alternate 1 min running / 1.5 min walking for 20 min"
{
  "type": "intervals",
  "description": "5 min warm-up walk, then alternate 1 min running / 1.5 min walking for 20 min",
  "distance_meters": 2800,
  "intensity": "easy",
  "pace_guidance": "Conversational pace — slow down if you can't talk",
  "notes": "Run/walk intervals. Focus on breathing comfortably.",
  "structured_workout": {
    "warmup": { "duration_minutes": 5, "intensity": "walk" },
    "main_set": [
      { "repeat": 8, "intervals": [
        { "duration_seconds": 60, "intensity": "easy" },
        { "duration_seconds": 90, "intensity": "walk" }
      ]}
    ]
  }
}

EXAMPLE — continuous run: Template says "5 min warm-up walk, then 25 min running"
{
  "type": "easy_run",
  "description": "5 min warm-up walk, then 25 min continuous running",
  "distance_meters": 3500,
  "intensity": "easy",
  "pace_guidance": "Conversational pace — slow down if you can't talk",
  "notes": "No walking breaks. Maintain an easy, sustainable pace.",
  "structured_workout": {
    "warmup": { "duration_minutes": 5, "intensity": "walk" },
    "main_set": [
      { "repeat": 1, "intervals": [
        { "duration_seconds": 1500, "intensity": "easy" }
      ]}
    ]
  }
}

DO NOT INCLUDE:
- distance_meters inside structured_workout interval steps — do NOT convert time to distance
- Any distance-based interval descriptions (e.g. "8 × 1200m") — use time descriptions from the template` : `STRUCTURED WORKOUT:
Include "structured_workout" for type "intervals" and for tempo workouts prescribed by time.
- Distance-based intervals: use distance_meters in each interval step
- Time-based quality sessions (tempo by time, hill sprints, fartlek): use duration_seconds in each interval step
  Do NOT mix distance_meters and duration_seconds within the same main_set.
CRITICAL: For type "intervals", main_set MUST contain at least one repeat group — never output main_set as an empty array []. Derive the structure from the description (e.g. "6 × 800m w/400m jog" → repeat:6 with distance_meters:800 work + distance_meters:400 recovery).
For all other types (easy_run, recovery, long_run, rest, cross_training, race):
Omit "structured_workout" entirely — the server generates it automatically.

EXAMPLE — distance-based intervals: Template says "Strength: 3 × 2 mi., 800 recovery"
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

EXAMPLE — time-based tempo: Template says "LT 20min split total"
{
  "type": "tempo",
  "description": "LT Tempo 20 min",
  "distance_meters": null,
  "duration_seconds": 1200,
  "intensity": "lactate_threshold",
  "pace_guidance": "Comfortably hard — sustainable for 20-60 minutes",
  "structured_workout": {
    "main_set": [
      { "repeat": 1, "intervals": [
        { "duration_seconds": 1200, "intensity": "lactate_threshold" }
      ]}
    ]
  }
}

EXAMPLE — hill sprints: Template says "Hill Sprints 6x10sec"
{
  "type": "intervals",
  "description": "Hill Sprints 6 × 10 sec",
  "distance_meters": null,
  "duration_seconds": 60,
  "intensity": "speed",
  "pace_guidance": "Maximum effort uphill sprints with full recovery jog down",
  "structured_workout": {
    "main_set": [
      { "repeat": 6, "intervals": [
        { "duration_seconds": 10, "intensity": "speed" },
        { "duration_seconds": 120, "intensity": "recovery" }
      ]}
    ]
  }
}

STRUCTURED WORKOUT FIDELITY — CRITICAL:
- For prescribed Q-slots tagged [SESSION], emit structured_workout with main_set covering the prescribed work. For slots WITHOUT [SESSION] (and for non-Q workouts that aren't intervals/tempo), do NOT emit structured_workout — leave the field absent.
- When [W/C: included]: main_set covers the FULL description including its leading/trailing easy segments. Do NOT emit separate warmup/cooldown fields around it — those easy bookends ARE the W/C, expressed as easy entries within main_set.
- When [W/C: add]: emit warmup + main_set + cooldown around the prescribed work.
- The structured_workout MUST account for the FULL distance/time scope of the description. If the description prescribes a base run distance plus added work (e.g. "9 mi (14 km) easy run + Hill Sprints 8 × 10 sec", "Warmup: 4 miles easy. Main: 6 × 1 mile @ MP."), structured_workout MUST include that base distance — either as warmup, as a leading easy main_set group, or as cooldown — never silently dropped.
- NEVER rely on the default 15-min warmup when the description specifies a base distance. The base distance overrides any default.
- Echo the slot-level metadata back on the workout: "is_session": true|false, and "warmup_cooldown": "included"|"add" when applicable.
- distance_meters values MUST be in METERS. 1 mi = 1609 m, 1 km = 1000 m. NEVER write distance_meters: 9 for "9 mi" — write 14484. NEVER pick the kilometer value when the primary unit in the description is miles (e.g. "9 mi (14 km)" → 14484, not 9000 or 14000).

EXAMPLE — easy run with sprints: Template says "9 mi (14 km) easy run + Hill Sprints 8 × 10 sec"
{
  "type": "intervals",
  "description": "9 mi (14 km) easy run + Hill Sprints 8 × 10 sec",
  "distance_meters": 14484,
  "intensity": "easy",
  "pace_guidance": "Easy aerobic run with explosive hill sprints near the end",
  "structured_workout": {
    "warmup": { "duration_minutes": 10, "intensity": "easy" },
    "main_set": [
      { "repeat": 1, "intervals": [{ "distance_meters": 14484, "intensity": "easy" }] },
      { "repeat": 8, "intervals": [
        { "duration_seconds": 10, "intensity": "speed" },
        { "duration_seconds": 120, "intensity": "recovery" }
      ]}
    ],
    "cooldown": { "duration_minutes": 5, "intensity": "easy" }
  }
}
NOTE: the 14484 m base appears as a leading main_set group AND in the top-level distance_meters. Sprints follow as a sibling group. Do NOT collapse these into the warmup default.

DO NOT INCLUDE:
- duration_minutes (system calculates display duration from distance + athlete's pace)
- distance_meters: 0 (use null instead when workout is time-prescribed)`}

IMPORTANT:
- Generate EXACTLY ${weeksNeeded} weeks
- Week ${weeksNeeded}, Day ${raceDayNumber} MUST be the race day (type="race", description="${distanceLabel.charAt(0).toUpperCase() + distanceLabel.slice(1)} Race Day")
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
