# Phase 2.1: Race Date Bug Fix - Implementation Guide

## Overview

This document addresses the critical race date calculation bug identified during Phase 2 testing. The bug causes generated plans to finish 1-4 days off from the goal date.

**Problem:** Complex date math trying to calculate which day-of-week the race falls on within a partial final week.

**Solution:** Force plan to start on a consistent day-of-week (Monday or Sunday) and add "ramp-in" easy runs for any partial week before the plan starts.

---

## Root Cause Analysis

### The Bug

The system attempts to calculate `raceDayNumber` (which day 1-7 within the final week the race falls on) based on the difference between start date and goal date day-of-week. This is mathematically complex and error-prone.

**Example of Failure:**
- Start: Friday, December 12, 2025
- Goal: Sunday, April 19, 2026
- Expected: Race on April 19
- Actual: Race lands on April 15, 18, or 22 (varies by template/LLM response)

### Why the Original Approach Failed

1. Assumes final week starts on same day-of-week as first week (not always true)
2. LLM struggles to respect calculated `raceDayNumber` constraint
3. Creates inconsistent W#:D# indexing (W1:D1 might be Friday, but W18:D1 might be Wednesday)

---

## Proposed Solution: Pre-Week Ramp-In

### Concept

1. **Force consistent week start:** All weeks start on Monday (or Sunday, user preference)
2. **Add partial week:** If user selects start date before next Monday, generate easy "ramp-in" runs
3. **Simplify math:** Race date calculation becomes straightforward

### Example

**User Input:**
- Start Date: Friday, December 12, 2025
- Goal Date: Sunday, April 19, 2026
- Preferred First Day: Monday

**System Calculates:**
- Next Monday: December 15, 2025
- Partial days: 3 (Fri, Sat, Sun before Monday)
- Weeks needed: (April 19 - December 15) ÷ 7 = 18.57 weeks = 19 full weeks
- Race day: Sunday = Day 7 of Week 19

**Generated Plan:**
```
Pre-Week (W0): December 12-14, 2025
  W0:D1 (Fri): Easy run 10km
  W0:D2 (Sat): Easy run 10km
  W0:D3 (Sun): Easy run 10km

Week 1: December 15-21, 2025
  W1:D1 (Mon): [Template workout]
  W1:D2 (Tue): [Template workout]
  ...
  W1:D7 (Sun): Long run

Week 19: April 13-19, 2026
  W19:D1 (Mon): [Template workout]
  ...
  W19:D7 (Sun): **MARATHON RACE**
```

---

## Benefits

1. **Mathematically Simple:** All weeks start on same day, straightforward date arithmetic
2. **LLM-Friendly:** Clear instructions, no complex day-of-week calculations
3. **Training Sound:** Easy ramp-in period is better for athletes than jumping into structured training
4. **Consistent Indexing:** W#:D# format always means the same day-of-week
5. **Fixes Bug:** Race will land exactly on goal date
6. **Flexible:** Works with any user-selected start date

---

## Implementation Overview

### Files to Modify

1. ✏️ `app/dashboard/plans/new/page.tsx` - Add "First Day of Week" preference
2. ✏️ `lib/plans/llm-prompts.ts` - Update prompt with pre-week logic
3. ✏️ `lib/plans/response-parser.ts` - Handle day=0 for pre-week workouts
4. ✏️ `lib/plans/plan-writer.ts` - Write pre-week workouts to database
5. ✏️ `types/database.ts` - Add preWeekWorkouts to ParsedPlan type

### Files to Inspect (No Changes Likely Needed)

- `app/api/plans/generate/route.ts` - Already passes through dates correctly
- `lib/plans/draft-plan.ts` - No changes needed
- Database schema - Can use week_number=0 for pre-week

---

## Detailed Implementation Recommendations

### Recommendation 1: Add First Day of Week Preference

**File:** `app/dashboard/plans/new/page.tsx`

**What to Add:**

Add a dropdown for "First Day of Week" preference (Monday or Sunday). Store as 0 (Sunday) or 1 (Monday) to match JavaScript Date.getDay().

**Pass to next page:** Include `first_day_of_week` in query params when navigating to recommendations page.

**Default:** Monday (1) - most common for training plans

**Claude Code Prompt:**
```
Update app/dashboard/plans/new/page.tsx to add:

1. State: const [firstDayOfWeek, setFirstDayOfWeek] = useState<0 | 1>(1)
   - 0 = Sunday
   - 1 = Monday

2. UI Element: Add a Select dropdown after "Days per Week":
   - Label: "Week Starts On"
   - Options: "Monday" (value=1), "Sunday" (value=0)
   - Helper text: "Your training weeks will start on this day"

3. Pass Value: Add first_day_of_week=${firstDayOfWeek} to query params when navigating

4. Form Validation: No additional validation needed (it's just a preference)

Use shadcn Select component.
Match styling of existing form fields.
```

**Note to Claude Code:** Inspect the existing form structure and match the pattern. The form already has goal_date, goal_type, experience, current, peak, days, methodology - add this as another field in the same style.

---

### Recommendation 2: Update Prompt Builder

**File:** `lib/plans/llm-prompts.ts`

**What to Change:**

The `buildGenerationSystemPrompt` function needs to:
1. Accept `firstDayOfWeek` parameter
2. Calculate next occurrence of that day-of-week from start date
3. Calculate partial days between start date and plan start date
4. Calculate weeks needed from plan start to goal
5. Determine which day (1-7) the race falls on

**Key Logic:**

```typescript
// Find next occurrence of preferred first day
const planStartDate = getNextDayOfWeek(startDate, firstDayOfWeek)

// Calculate partial days (0-6)
const partialDays = differenceInCalendarDays(planStartDate, startDate)

// Calculate full weeks from plan start to goal
const weeksNeeded = Math.floor(differenceInCalendarDays(goalDate, planStartDate) / 7)

// Calculate which day of the week the race falls on
const raceDayOfWeek = goalDate.getDay()
const raceDayNumber = raceDayOfWeek === firstDayOfWeek ? 1 : 
  ((raceDayOfWeek - firstDayOfWeek + 7) % 7) + 1
```

**Prompt Updates:**

- Add section about pre-week if `partialDays > 0`
- Instruct LLM to generate pre-week workouts with `day: 0`
- Update race day instruction to use calculated `raceDayNumber`
- Simplify language (remove complex date math explanations)

**Claude Code Prompt:**
```
Update lib/plans/llm-prompts.ts:

1. Add parameter to buildGenerationSystemPrompt:
   firstDayOfWeek: 0 | 1  (0=Sunday, 1=Monday)

2. Add helper function at top of file:
   function getNextDayOfWeek(date: Date, targetDay: number): Date {
     // Returns the next occurrence of targetDay (0-6) on or after date
     const result = new Date(date)
     const currentDay = date.getDay()
     const daysUntilTarget = targetDay === currentDay ? 0 : 
       ((targetDay - currentDay + 7) % 7)
     result.setDate(date.getDate() + daysUntilTarget)
     return result
   }

3. In buildGenerationSystemPrompt, calculate:
   - planStartDate = getNextDayOfWeek(startDate, firstDayOfWeek)
   - partialDays = differenceInCalendarDays(planStartDate, startDate)
   - weeksNeeded = Math.floor(differenceInCalendarDays(goalDate, planStartDate) / 7)
   - raceDayOfWeek = goalDate.getDay()
   - raceDayNumber = raceDayOfWeek === firstDayOfWeek ? 1 : 
       ((raceDayOfWeek - firstDayOfWeek + 7) % 7) + 1

4. Update TIMELINE section in prompt:
   - Athlete selected start date: ${format(startDate, 'EEEE, MMMM d, yyyy')}
   - Plan officially begins: ${format(planStartDate, 'EEEE, MMMM d, yyyy')} (Week 1, Day 1)
   - Race date: ${format(goalDate, 'EEEE, MMMM d, yyyy')} (Week ${weeksNeeded}, Day ${raceDayNumber})

5. Add PARTIAL WEEK section if partialDays > 0:
   Before the plan begins, generate ${partialDays} easy runs for the days between 
   ${format(startDate, 'MMM d')} and ${format(addDays(planStartDate, -1), 'MMM d')}:
   - Distance: ${(userCriteria.current_weekly_mileage * 0.15).toFixed(1)}km per run
   - Intensity: easy (conversational pace)
   - Purpose: Ramp-in period before structured training
   - Format: {"day": 0, "type": "easy_run", "distance": X, "description": "Easy ramp-in run"}
   (Use day: 0 to indicate these are pre-week workouts)

6. Update CRITICAL INSTRUCTIONS:
   - Generate EXACTLY ${weeksNeeded} full weeks (Week 1 through Week ${weeksNeeded})
   - Week 1, Day 1 starts on ${format(planStartDate, 'EEEE, MMMM d')}
   - The marathon race MUST be on Week ${weeksNeeded}, Day ${raceDayNumber} (${format(goalDate, 'EEEE, MMMM d')})
   - Each week has EXACTLY 7 days (numbered 1-7)
   - Do NOT create day 8, 9, 10, etc.

Use date-fns for date calculations: differenceInCalendarDays, addDays, format
Import at top: import { differenceInCalendarDays, addDays, format } from 'date-fns'
```

**Note to Claude Code:** The existing function already has start_date and goal_date parameters. Add firstDayOfWeek as a new parameter. The function returns a string (the system prompt), so you're building a longer string with the new sections added.

---

### Recommendation 3: Update Response Parser

**File:** `lib/plans/response-parser.ts`

**What to Change:**

The parser needs to handle `day: 0` for pre-week workouts separately from regular weeks.

**Key Logic:**

```typescript
// Separate pre-week workouts from regular weeks
const preWeekWorkouts: Workout[] = []
const regularWeeks: WeekSchedule[] = []

for (const week of parsed.weeks) {
  const weekWorkouts: Workout[] = []
  
  for (const workout of week.workouts) {
    if (workout.day === 0) {
      preWeekWorkouts.push(workout)
    } else if (workout.day >= 1 && workout.day <= 7) {
      weekWorkouts.push(workout)
    } else {
      throw new Error(`Invalid day number: ${workout.day} (must be 0-7)`)
    }
  }
  
  if (weekWorkouts.length > 0) {
    regularWeeks.push({
      week_number: week.week,
      workouts: weekWorkouts
    })
  }
}

return {
  weeks: regularWeeks,
  preWeekWorkouts: preWeekWorkouts
}
```

**Claude Code Prompt:**
```
Update lib/plans/response-parser.ts:

1. Update ParsedPlan type (or create if not exists):
   interface ParsedPlan {
     weeks: WeekSchedule[]
     preWeekWorkouts: Workout[]  // NEW
   }

2. In parseLLMResponse function:
   - Add const preWeekWorkouts: Workout[] = []
   - When iterating through workouts, check if workout.day === 0
   - If day === 0, push to preWeekWorkouts array
   - If day >= 1 && day <= 7, continue normal processing
   - If day < 0 or day > 7, throw validation error

3. Update validation:
   - Change error message: "Invalid day number: ${workout.day} (must be 0-7)"
   - day 0 is now valid (pre-week workouts)

4. Return updated structure:
   return {
     weeks: regularWeeks,
     preWeekWorkouts: preWeekWorkouts
   }

5. If preWeekWorkouts is empty, that's fine (no partial week)

Inspect the existing parseLLMResponse function to understand current structure.
The function already validates day numbers - update that validation to accept 0.
```

**Note to Claude Code:** The existing parser likely has a loop that validates `workout.day >= 1 && workout.day <= 7`. Update this to accept 0 as valid, and collect those separately.

---

### Recommendation 4: Update Database Writer

**File:** `lib/plans/plan-writer.ts`

**What to Change:**

The writer needs to handle pre-week workouts (if they exist) as a special "Week 0" before the regular weeks.

**Key Logic:**

```typescript
// Write pre-week if exists
if (planData.preWeekWorkouts && planData.preWeekWorkouts.length > 0) {
  // Create weekly_plan for pre-week
  const preWeekPlan = await supabase
    .from('weekly_plans')
    .insert({
      athlete_id: athleteId,
      phase_id: phases[0].id,  // Attach to first phase
      week_start_date: format(startDate, 'yyyy-MM-dd'),
      week_number: 0,  // Special: pre-week
      weekly_volume_target: calculatePreWeekVolume(planData.preWeekWorkouts),
      status: 'planned'
    })
    .select()
    .single()
  
  // Write pre-week workouts
  for (let i = 0; i < planData.preWeekWorkouts.length; i++) {
    const workout = planData.preWeekWorkouts[i]
    const workoutDate = addDays(startDate, i)
    
    await supabase.from('planned_workouts').insert({
      weekly_plan_id: preWeekPlan.data.id,
      athlete_id: athleteId,
      scheduled_date: format(workoutDate, 'yyyy-MM-dd'),
      workout_index: `W0:D${i + 1}`,  // W0:D1, W0:D2, W0:D3
      workout_type: workout.type,
      description: workout.description,
      distance_target_meters: workout.distance ? workout.distance * 1000 : null,
      intensity_target: workout.intensity || 'easy',
      status: 'scheduled'
    })
  }
}

// Continue with regular weeks (Week 1, 2, 3, ...)
```

**Claude Code Prompt:**
```
Update lib/plans/plan-writer.ts:

1. Update writePlanToDatabase function signature to accept:
   - Add planData.preWeekWorkouts (Workout[] | undefined)

2. Before writing regular weeks, add pre-week handling:
   if (planData.preWeekWorkouts && planData.preWeekWorkouts.length > 0) {
     // Calculate pre-week volume
     const preWeekVolume = planData.preWeekWorkouts.reduce((sum, w) => 
       sum + (w.distance || 0), 0)
     
     // Create weekly_plans record for Week 0
     const { data: preWeekPlan, error: preWeekError } = await supabase
       .from('weekly_plans')
       .insert({
         athlete_id: athleteId,
         phase_id: phases[0].id,  // Use first phase
         week_start_date: format(startDate, 'yyyy-MM-dd'),
         week_number: 0,
         weekly_volume_target: preWeekVolume,
         status: 'planned'
       })
       .select()
       .single()
     
     if (preWeekError) throw preWeekError
     
     // Write each pre-week workout
     for (let i = 0; i < planData.preWeekWorkouts.length; i++) {
       const workout = planData.preWeekWorkouts[i]
       const workoutDate = addDays(startDate, i)
       
       await supabase.from('planned_workouts').insert({
         weekly_plan_id: preWeekPlan.id,
         athlete_id: athleteId,
         scheduled_date: format(workoutDate, 'yyyy-MM-dd'),
         workout_index: `W0:D${i + 1}`,
         workout_type: workout.type,
         description: workout.description || 'Easy ramp-in run',
         distance_target_meters: workout.distance ? workout.distance * 1000 : null,
         intensity_target: workout.intensity || 'easy',
         status: 'scheduled'
       })
     }
   }

3. Regular weeks: No changes needed (they start from Week 1 as before)

4. Use date-fns addDays and format for date calculations

Inspect the existing writePlanToDatabase function structure.
The pre-week section should come BEFORE the loop that writes regular weeks.
Use the same pattern for error handling that exists in the current code.
```

**Note to Claude Code:** The existing function likely has a loop over `planData.weeks`. Add the pre-week handling before that loop starts. The pre-week is optional (only if `preWeekWorkouts` exists and has items).

---

### Recommendation 5: Update Type Definitions

**File:** `types/database.ts` or `types/index.ts`

**What to Change:**

Add `preWeekWorkouts` field to the `ParsedPlan` interface (if it exists as a separate type).

**Claude Code Prompt:**
```
Update type definitions:

1. Find the ParsedPlan interface (might be in types/database.ts or types/index.ts)

2. Add field:
   preWeekWorkouts?: Workout[]  // Optional: ramp-in workouts before Week 1

3. If ParsedPlan doesn't exist, it might be defined inline in response-parser.ts
   In that case, update it there (you'll already be doing this in Recommendation 3)

This is a simple type addition - just add the optional field to the interface.
```

**Note to Claude Code:** Inspect the existing types to see where `ParsedPlan` is defined. If it's exported from a types file, update it there. If it's local to response-parser.ts, update it there.

---

### Recommendation 6: Update API Route to Pass Parameters

**File:** `app/api/plans/generate/route.ts`

**What to Check:**

The API route should already be passing `start_date` to the prompt builder. Verify it also passes `firstDayOfWeek`.

**Claude Code Prompt:**
```
Update app/api/plans/generate/route.ts:

1. In POST handler, extract from request body:
   const { first_day_of_week } = body  // NEW
   
   // Validate: should be 0 or 1
   if (first_day_of_week !== undefined && first_day_of_week !== 0 && first_day_of_week !== 1) {
     return NextResponse.json({ error: 'Invalid first_day_of_week' }, { status: 400 })
   }

2. Pass to buildGenerationSystemPrompt:
   const systemPrompt = buildGenerationSystemPrompt(
     fullTemplate,
     new Date(goal_date),
     new Date(start_date),
     first_day_of_week ?? 1,  // Default to Monday if not provided
     user_criteria
   )

3. Pass to buildGenerationUserMessage (if it needs it):
   Check if this function needs firstDayOfWeek - probably not

Inspect the existing API route to see current parameter passing.
Add first_day_of_week in the same way start_date is already handled.
```

**Note to Claude Code:** This file likely already extracts `start_date` from the request body and passes it to prompts. Do the same for `first_day_of_week`. Default to 1 (Monday) if not provided for backward compatibility.

---

### Recommendation 7: Update Generate Page

**File:** `app/dashboard/plans/generate/page.tsx`

**What to Check:**

This page reads query params and passes them to the API. Verify it includes `first_day_of_week`.

**Claude Code Prompt:**
```
Update app/dashboard/plans/generate/page.tsx:

1. Extract from query params:
   const firstDayOfWeek = searchParams.get('first_day_of_week')

2. Include in fetch body:
   body: JSON.stringify({
     template_id: templateId,
     goal_date: goalDate,
     goal_type: goalType,
     goal_name: goalName,
     start_date: startDate,  // Should already exist
     first_day_of_week: firstDayOfWeek ? parseInt(firstDayOfWeek) : 1,  // NEW
     user_criteria: userCriteria
   })

This is a simple pass-through - read from URL params, send to API.
Match the pattern of how start_date is already handled.
```

**Note to Claude Code:** Inspect how this page currently handles other query parameters. Add `first_day_of_week` using the same pattern.

---

### Recommendation 8: Update Recommend Page

**File:** `app/dashboard/plans/recommend/page.tsx`

**What to Check:**

This page constructs the URL when navigating to the generate page. Verify it includes `first_day_of_week`.

**Claude Code Prompt:**
```
Update app/dashboard/plans/recommend/page.tsx:

1. Extract from query params:
   const firstDayOfWeek = searchParams.get('first_day_of_week')

2. Include in navigation URL:
   router.push(`/dashboard/plans/generate?${params}`)
   
   Where params includes:
   &first_day_of_week=${firstDayOfWeek || '1'}

This is just passing the parameter through from form → recommend → generate.
Match the pattern of how other parameters are passed.
```

**Note to Claude Code:** This is a pass-through page. It receives `first_day_of_week` from the form and passes it to the generate page. Use the same pattern as other parameters.

---

## Testing Plan

### Test Case 1: Monday Start, No Partial Week

**Input:**
- Start Date: Monday, December 15, 2025
- Goal Date: Sunday, April 19, 2026
- First Day of Week: Monday

**Expected:**
- No pre-week workouts (W0)
- Week 1 starts December 15
- 19 full weeks generated
- Race on Week 19, Day 7 (Sunday, April 19)

### Test Case 2: Friday Start, Partial Week

**Input:**
- Start Date: Friday, December 12, 2025
- Goal Date: Sunday, April 19, 2026
- First Day of Week: Monday

**Expected:**
- Pre-week workouts: W0:D1 (Fri), W0:D2 (Sat), W0:D3 (Sun)
- Week 1 starts Monday, December 15
- 19 full weeks generated
- Race on Week 19, Day 7 (Sunday, April 19)

### Test Case 3: Sunday Start, Sunday Preference

**Input:**
- Start Date: Sunday, December 14, 2025
- Goal Date: Saturday, April 18, 2026
- First Day of Week: Sunday

**Expected:**
- No pre-week workouts (starts on preferred day)
- Week 1 starts Sunday, December 14
- 18 full weeks generated
- Race on Week 18, Day 7 (Saturday, April 18)

### Test Case 4: Wednesday Start, Partial Week

**Input:**
- Start Date: Wednesday, December 10, 2025
- Goal Date: Sunday, April 19, 2026
- First Day of Week: Monday

**Expected:**
- Pre-week workouts: W0:D1 (Wed), W0:D2 (Thu), W0:D3 (Fri), W0:D4 (Sat), W0:D5 (Sun)
- Week 1 starts Monday, December 15
- 19 full weeks generated
- Race on Week 19, Day 7 (Sunday, April 19)

### Validation Checklist

After implementation, verify:

- [ ] Pre-week workouts appear in database with week_number=0
- [ ] Pre-week workouts have workout_index W0:D1, W0:D2, etc.
- [ ] Pre-week workouts are easy runs at ~15% of weekly volume
- [ ] Week 1 starts on preferred first day of week
- [ ] All regular weeks numbered 1, 2, 3, ..., N
- [ ] Race lands exactly on goal date
- [ ] W#:D# indexing is consistent (W1:D1 always Monday/Sunday)
- [ ] No days 8, 9, 10 generated
- [ ] Calendar displays pre-week workouts correctly
- [ ] Total plan duration is correct

---

## Implementation Order

1. **Start with types** (Recommendation 5) - Foundation
2. **Update prompt builder** (Recommendation 2) - Core logic
3. **Update parser** (Recommendation 3) - Handle new structure
4. **Update database writer** (Recommendation 4) - Persist to DB
5. **Update form** (Recommendation 1) - User input
6. **Update page connections** (Recommendations 6-8) - Pass data through
7. **Test** - Verify with all test cases

---

## Expected LLM Response Format

With the updated prompt, the LLM should return:

```json
{
  "weeks": [
    {
      "week": 1,
      "workouts": [
        {"day": 0, "type": "easy_run", "distance": 10, "description": "Easy ramp-in run"},
        {"day": 0, "type": "easy_run", "distance": 10, "description": "Easy ramp-in run"},
        {"day": 0, "type": "easy_run", "distance": 10, "description": "Easy ramp-in run"}
      ]
    },
    {
      "week": 1,
      "workouts": [
        {"day": 1, "workout_index": "W1:D1", "type": "easy_run", ...},
        {"day": 2, "workout_index": "W1:D2", "type": "tempo", ...},
        ...
      ]
    },
    ...
  ]
}
```

Or the pre-week workouts might be in a separate array at the root level:

```json
{
  "pre_week": [
    {"day": 0, "type": "easy_run", "distance": 10, "description": "Easy ramp-in run"},
    ...
  ],
  "weeks": [
    {
      "week": 1,
      "workouts": [...]
    },
    ...
  ]
}
```

The parser should be flexible enough to handle both formats.

---

## Rollback Plan

If this approach causes issues:

1. **Immediate rollback:** Revert to previous prompt (ignores firstDayOfWeek, no pre-week)
2. **Partial rollback:** Keep firstDayOfWeek UI but default to current behavior
3. **Data cleanup:** Delete any plans with week_number=0 if needed

---

## Notes for Claude Code

### Context Inference

This document provides recommendations, not exact code. Claude Code should:

1. **Inspect existing files first** - Understand current structure before making changes
2. **Match existing patterns** - Use the same coding style, error handling, imports
3. **Be conservative** - If unclear, ask for clarification rather than guessing
4. **Test incrementally** - Make changes in order, test after each step

### Key Principles

- Pre-week workouts are **optional** (only if start date is before next Monday/Sunday)
- Pre-week workouts are **easy runs** at ~15% of weekly volume
- Week numbering: **W0** for pre-week, **W1-WN** for regular weeks
- Day numbering: **1-7** for all weeks (no day 0 within regular weeks)
- Race date calculation should be **simple** now (straightforward arithmetic)

### What NOT to Change

- Don't change the template structure or catalog system
- Don't modify the recommendation algorithm (Phase 1)
- Don't change how LLM providers work
- Don't alter the database schema (we can use week_number=0)

### Success Criteria

Implementation is successful when:

1. Plans finish exactly on goal date (no more 1-4 day errors)
2. Pre-week workouts appear correctly (when applicable)
3. All weeks start on consistent day-of-week
4. W#:D# indexing is predictable
5. LLM instructions are clear and followed
6. No days 8, 9, 10 generated

---

## Summary

This fix transforms a complex date calculation problem into a simple, intuitive solution:

**Before:** "Calculate which day-of-week the race falls on within a potentially partial final week"

**After:** "Make weeks start on a consistent day, add easy runs before if needed"

The solution is:
- ✓ Simpler to implement
- ✓ Easier for LLM to follow
- ✓ Better for athletes (ramp-in period)
- ✓ More predictable (consistent W#:D# indexing)
- ✓ Fixes the bug completely

Good luck with implementation!
