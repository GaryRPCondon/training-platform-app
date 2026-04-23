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

  // Build per-week targets table from template's weekly_schedule (when plan_week/total_km present)
  const weeklyTargetRows = (template.weekly_schedule ?? [])
    .filter(w => typeof w.plan_week === 'number' && typeof w.total_km === 'number')
    .sort((a, b) => (a.plan_week ?? 0) - (b.plan_week ?? 0))
  const weeklyTargetsSection = weeklyTargetRows.length > 0 ? `
PER-WEEK TARGETS (BINDING — copy these totals exactly; ±10% maximum):
Week | total_km | Q1_km | Q2_km | E_days_total_km | E per day (${criteria.days_per_week}d - 2 Q = ${criteria.days_per_week - 2} E days)
${weeklyTargetRows.map(w => {
  const eDays = criteria.days_per_week - 2
  const ePerDay = eDays > 0 && typeof w.E_days_total_km === 'number'
    ? (w.E_days_total_km / eDays).toFixed(1)
    : '—'
  return `W${w.plan_week} | ${w.total_km} | ${w.Q1_km ?? '—'} | ${w.Q2_km ?? '—'} | ${w.E_days_total_km ?? '—'} | ${ePerDay}`
}).join('\n')}

CRITICAL: The "E per day" column is \`E_days_total_km / ${criteria.days_per_week - 2}\` — use THIS value for every E day, NOT the per-day \`km\` in \`E_days_distribution\` (that column lists fewer days and would inflate the weekly total if copied verbatim across ${criteria.days_per_week - 2} days). Each week's \`weekly_total_km\` field you emit MUST equal the \`total_km\` above for that plan_week.
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
${weeklyTargetsSection}

MEASUREMENT UNITS:
- Athlete's preferred unit system: ${preferred_units === 'imperial' ? 'Imperial (miles)' : 'Metric (km)'}
- distance_meters field: ALWAYS in meters regardless of preference
- description field: follow the template's dual-unit style for continuous runs, mile-based for intervals
  - Continuous runs: "Easy 8 mi. (13 km)", "Tempo 8 mi. (13 km)", "Long 16 mi. (27 km)"
  - Intervals: use miles for rep distances, metres for short recoveries — "6 × 1 mi., 400 recovery"
  - Sub-mile track distances always in metres: 400m, 800m, 1200m
  Scale distances to fit the athlete's load, but always use this style — never raw metre conversions like "4828m"
- pace_guidance field: use min/km for metric, min/mile for imperial
${template.workout_notation ? `
WORKOUT NOTATION (FROM TEMPLATE — CRITICAL):
The weekly_schedule descriptions in this template use these notation conventions:
${Object.entries(template.workout_notation).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

DISTANCE vs TIME — HARD RULE:
- When a description uses a distance shorthand (e.g. "9E", "4T", "3T", "12M", "15M"), the number is a **distance in miles** — the structured_workout interval step MUST use \`distance_meters = round(miles × 1609)\`.
- Only convert to \`duration_seconds\` when the template explicitly writes "N min" / "N sec" (e.g. "2 min rest", "80 min E", "3 min I w/2 min jg", "Hill Sprints 6×10sec").
- NEVER guess a minutes-per-mile ratio. NEVER emit \`duration_seconds\` for a distance-shorthand segment.
- Example: description "9E + 4T + 2 min rest + 4E + 2 × (3T w/1 min rests) + 4E"
  → 9E = distance_meters: 14484, 4T = distance_meters: 6437, 2 min rest = duration_seconds: 120,
    4E = distance_meters: 6437, 3T = distance_meters: 4828, 1 min rest = duration_seconds: 60,
    5E (if present) = distance_meters: 8046.
` : ''}

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
${raceWeekSection}

KEY PRINCIPLES:
1. Follow the template's training philosophy throughout
2. Maintain the core workout structure and progression patterns
3. Adapt phase lengths proportionally to fit ${weeksNeeded} weeks
4. HARD VOLUME CEILING: No week may exceed ${criteria.comfortable_peak_mileage}km total — not even by 1km
5. WEEK 1 ANCHOR: Week 1 total must match the template's plan_week=1 total_km if the template provides it (athlete is already at that volume). Otherwise start at or below the athlete's current weekly mileage (${criteria.current_weekly_mileage}km).
6. Schedule workouts on EXACTLY ${criteria.days_per_week} days per week. Maximum rest days per week = ${7 - criteria.days_per_week}.
   - If the template's \`E_days_distribution\` lists FEWER E days than you need, divide the template's \`E_days_total_km\` evenly across ALL E days you plan to run — do NOT keep the per-day \`km\` from E_days_distribution and add extra days on top. Adding a day without reducing per-day volume would violate the weekly total.
   - Example: template has 4 E days at 18km each (E_days_total_km=72) but you need 5 E days → each E day becomes ~14.4km, NOT five days at 18km (which would add 18km to the weekly total).
   - When days_per_week = 7, NO rest days are allowed. Every day must be a run (Q1, Q2, or easy).${criteria.preferred_rest_days && criteria.preferred_rest_days.length > 0 ? `
7. MANDATORY: Schedule rest days on: ${criteria.preferred_rest_days.map(d => dayNames[d]).join(', ')}
   - These are the athlete's REQUIRED non-training days
   - You MUST place rest days on these specific days of the week
   - Adjust the template's workout schedule to accommodate this requirement
   - The athlete's schedule preferences override the template's default rest day placement
8. Build progressively from the Week 1 base toward the peak, following the template's volume curve` : `
7. Build progressively from the Week 1 base toward the peak, following the template's volume curve`}

VOLUME CONSTRAINTS (HARD — binding when the template provides these fields):
- PER-WEEK TOTAL: When a weekly_schedule entry provides \`total_km\`, that week's \`weekly_total_km\` MUST be within ±10% of \`total_km\`. This overrides any pattern you would otherwise extrapolate.
- PER-DAY EASY MILEAGE: When an \`E_days_distribution\` entry provides \`km\`, that day's \`distance_meters\` MUST be within ±10% of \`km × 1000\`.
- LONG-RUN CAP: A workout's \`distance_meters\` MUST NOT exceed the template's \`validation_ranges.long_run.max\`.
- Q SESSION FIDELITY: When a weekly_schedule entry provides \`Q1\` / \`Q2\` descriptions, the generated Q1/Q2 structured_workouts MUST match the described segments exactly (same number of work/rest blocks, same distances or times per segment as dictated by WORKOUT NOTATION). Do NOT substitute a different workout.

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
- long_run (for long runs — pure steady aerobic effort only, no embedded quality segments)
- tempo (for tempo runs, race pace efforts, and long runs with marathon/threshold segments)
- intervals (for speed/interval workouts)
- rest (for rest days)
- cross_training (for cross-training activities)
- race (for goal race day - marathon, half marathon, 10K, 5K, ultra, etc.)

Q-SESSION CLASSIFICATION (CRITICAL when the template provides Q1/Q2 descriptions):
- If the Q-session description contains ANY M (marathon-pace), T (threshold/tempo), I (interval), or R (repetition) segment — type it as "tempo" (if primarily M/T) or "intervals" (if primarily I/R) so the structured_workout preserves the quality segments. Emit the full structured_workout with sibling groups matching the description.
- Only use "long_run" when the Q-session is pure steady easy running with NO quality segments (e.g. "steady E run of 240-270 min").
- Example: "6E + 12M + 2T + 5M + 4E" → type=tempo (not long_run). "steady E run of 270-300 min" → type=long_run.

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
- MIXED sessions (distance segments AND time segments within one workout — e.g. Daniels "9E + 4T + 2 min rest + 4E"): emit distance_meters on the distance segments and duration_seconds on the time segments. This is the ONLY case where distance_meters and duration_seconds may coexist in one main_set.
CRITICAL: For type "intervals", main_set MUST contain at least one repeat group — never output main_set as an empty array []. Derive the structure from the description (e.g. "6 × 800m w/400m jog" → repeat:6 with distance_meters:800 work + distance_meters:400 recovery).

FLAT main_set RULE — ABSOLUTE:
- \`main_set\` is a FLAT ARRAY of SIBLING repeat groups. NEVER nest a repeat group inside another group's \`intervals[]\`.
- To mix continuous segments with repeats, emit EACH continuous segment as its own \`repeat:1\` group and EACH repeated block as its own group.
- Every element of \`intervals[]\` inside a group MUST be a leaf step: \`{distance_meters|duration_seconds, intensity}\` — never another \`{repeat, intervals}\` object.

EXAMPLE — mixed distance + time sibling groups (Daniels "9E + 4T + 2 min rest + 4E + 2 × (3T w/1 min rests) + 4E"):
{
  "type": "tempo",
  "description": "9E + 4T + 2 min rest + 4E + 2 × (3T w/1 min rests) + 4E",
  "distance_meters": 45052,
  "intensity": "tempo",
  "pace_guidance": "T = threshold pace. Easy warm-up and cool-down at conversational pace.",
  "structured_workout": {
    "warmup": { "distance_meters": 14484, "intensity": "easy" },
    "main_set": [
      { "repeat": 1, "intervals": [{ "distance_meters": 6437, "intensity": "tempo" }] },
      { "repeat": 1, "intervals": [{ "duration_seconds": 120, "intensity": "rest" }] },
      { "repeat": 1, "intervals": [{ "distance_meters": 6437, "intensity": "easy" }] },
      { "repeat": 2, "intervals": [
        { "distance_meters": 4828, "intensity": "tempo" },
        { "duration_seconds": 60, "intensity": "rest" }
      ]}
    ],
    "cooldown": { "distance_meters": 6437, "intensity": "easy" }
  }
}
NOTE: the leading 9E is lifted into \`warmup\` and the trailing 4E is lifted into \`cooldown\` (both are opening/closing easy blocks that frame the quality work). DO NOT add an extra fixed-duration cooldown (like "10 min easy") when the template description already ends with an easy block — use that easy block AS the cooldown. Only add a time-based default cooldown when the template's last segment is NOT easy (e.g. the workout ends in tempo).

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
