# Phase 2: LLM Plan Generation Implementation

## Document Info
- **Phase:** 2 of 5
- **Estimated Time:** 2-3 days
- **Dependencies:** Phase 1 (Catalog System) must be complete
- **Reference:** See `MASTER_IMPLEMENTATION_PLAN.md` for overall context

---

## Phase Overview

**Goal:** Generate adapted training plans using LLM + selected template

**What You'll Build:**
1. Draft plan creation in database
2. LLM generation API with structured prompts
3. Template adaptation logic
4. JSON response parsing and validation
5. Database population (weekly_plans, planned_workouts)
6. Workout indexing (W#:D# format)

**Entry Point:** User clicks "Select This Template" on recommendation page
**Exit Point:** Draft plan generated with status='draft_generated', user enters Phase 3 (review)

---

## Prerequisites

### Phase 1 Must Be Complete
- ✓ Templates loading from `public/templates/`
- ✓ Recommendation engine working
- ✓ User can select template from recommendation page
- ✓ Navigation to `/dashboard/plans/generate?template=...` works

### Database Schema Updates Needed
Run these migrations before starting Phase 2:

```sql
-- Add new columns to training_plans
ALTER TABLE training_plans 
ADD COLUMN IF NOT EXISTS template_id TEXT,
ADD COLUMN IF NOT EXISTS template_version TEXT DEFAULT '1.0',
ADD COLUMN IF NOT EXISTS user_criteria JSONB;

-- Add workout indexing to planned_workouts
ALTER TABLE planned_workouts
ADD COLUMN IF NOT EXISTS workout_index TEXT;

CREATE INDEX IF NOT EXISTS idx_planned_workouts_index 
ON planned_workouts(weekly_plan_id, workout_index);

-- Update status enum if needed (add 'draft', 'draft_generated')
-- This depends on your current schema - check if these values exist
```

---

## Task 1: Draft Plan Creation

### 1.1 Create Draft Plan Logic

**File:** `lib/plans/draft-plan.ts`

```typescript
import { supabase, getCurrentAthleteId } from '@/lib/supabase/client'
import type { UserCriteria } from '@/lib/templates/types'

export interface DraftPlanData {
  template_id: string
  template_name: string
  goal_name?: string  // Optional user-provided goal name
  goal_date: string
  goal_type: string
  user_criteria: UserCriteria
}

/**
 * Create draft plan record in database
 */
export async function createDraftPlan(data: DraftPlanData) {
  const athleteId = getCurrentAthleteId()

  // Check for existing draft and delete it
  const { data: existingDrafts } = await supabase
    .from('training_plans')
    .select('id')
    .eq('athlete_id', athleteId)
    .in('status', ['draft', 'draft_generated'])

  if (existingDrafts && existingDrafts.length > 0) {
    // Delete existing drafts (cascade will handle related records)
    await supabase
      .from('training_plans')
      .delete()
      .in('id', existingDrafts.map(d => d.id))
  }

  // Create goal
  const goalDistances: Record<string, number> = {
    'marathon': 42195,
    'half_marathon': 21097,
    '10k': 10000,
    '5k': 5000
  }

  const { data: goal, error: goalError } = await supabase
    .from('athlete_goals')
    .insert({
      athlete_id: athleteId,
      goal_type: data.goal_type,
      goal_name: data.goal_name || `${data.goal_type.replace('_', ' ')} - ${data.template_name}`,
      target_date: data.goal_date,
      target_value: {
        distance_meters: goalDistances[data.goal_type]
      },
      status: 'active',
      priority: 1
    })
    .select()
    .single()

  if (goalError) throw goalError

  // Create training plan (draft status)
  const { data: plan, error: planError } = await supabase
    .from('training_plans')
    .insert({
      athlete_id: athleteId,
      goal_id: goal.id,
      name: `${data.template_name} - Draft`,
      start_date: new Date().toISOString().split('T')[0],
      end_date: data.goal_date,
      plan_type: data.goal_type,
      status: 'draft',
      created_by: 'agent',
      template_id: data.template_id,
      template_version: '1.0',
      user_criteria: data.user_criteria
    })
    .select()
    .single()

  if (planError) throw planError

  return { goal, plan }
}

/**
 * Get draft plan by ID
 */
export async function getDraftPlan(planId: number) {
  const { data, error } = await supabase
    .from('training_plans')
    .select(`
      *,
      athlete_goals (*),
      training_phases (*),
      weekly_plans (
        *,
        planned_workouts (*)
      )
    `)
    .eq('id', planId)
    .single()

  if (error) throw error
  return data
}

/**
 * Update plan status
 */
export async function updatePlanStatus(planId: number, status: string) {
  const { error } = await supabase
    .from('training_plans')
    .update({ status })
    .eq('id', planId)

  if (error) throw error
}
```

**Claude Code Prompt:**
```
Create lib/plans/draft-plan.ts with draft plan management functions.

Implement:
1. createDraftPlan(data) - Creates draft plan:
   - Check for existing drafts, delete if found (one draft per athlete)
   - Create athlete_goals record with goal_name (use data.goal_name or generate from goal_type + template_name)
   - Create training_plans record with:
     * status: 'draft'
     * template_id, template_version, user_criteria
     * Link to goal
   - Return { goal, plan }

2. getDraftPlan(planId) - Fetches plan with related data:
   - Include athlete_goals
   - Include training_phases (if any)
   - Include weekly_plans with planned_workouts

3. updatePlanStatus(planId, status) - Updates plan status

Use getCurrentAthleteId() for athlete_id.
Handle errors by throwing.
Export all functions.
```

---

## Task 2: LLM Prompt Construction

### 2.1 Create Prompt Builder

**File:** `lib/plans/llm-prompts.ts`

```typescript
import type { FullTemplate } from '@/lib/templates/types'
import type { UserCriteria } from '@/lib/templates/types'

export interface GenerationContext {
  template: FullTemplate
  criteria: UserCriteria
  goal_date: string
}

/**
 * Build system prompt for LLM plan generation
 */
export function buildGenerationSystemPrompt(context: GenerationContext): string {
  const { template, criteria } = context

  return `You are a marathon training coach specializing in ${template.author}'s methodology.

SELECTED TEMPLATE: ${template.name}
This is a ${template.author}-style plan, meaning you should follow ${template.author}'s training philosophy and approach.

USER CONSTRAINTS:
- Available weeks: ${criteria.weeks_available}
- Current weekly mileage: ${criteria.current_weekly_mileage}km
- Maximum comfortable weekly mileage: ${criteria.comfortable_peak_mileage}km
- Training days per week: ${criteria.days_per_week}
- Experience level: ${criteria.experience_level}

TASK:
Generate a personalized training plan by adapting the provided template to fit the user's constraints.

KEY PRINCIPLES:
1. Follow ${template.author}'s training philosophy throughout
2. Maintain the core workout structure and progression patterns
3. Compress or extend the timeline as needed (from ${template.duration_weeks} weeks to ${criteria.weeks_available} weeks)
4. Respect the weekly mileage ceiling (${criteria.comfortable_peak_mileage}km)
5. Adapt to ${criteria.days_per_week} training days per week
6. Ensure appropriate buildup from current ${criteria.current_weekly_mileage}km

WORKOUT INDEXING:
Every workout MUST have a unique index in the format: W{week}:D{day}
- Week numbers: 1 to ${criteria.weeks_available}
- Day numbers: 1 to 7 (Monday=1, Sunday=7)
- Examples: W1:D1, W1:D3, W2:D6, W${criteria.weeks_available}:D7

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

Return ONLY the JSON object, no markdown formatting, no extra text.`
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
1. Maintain ${template.author}'s training philosophy
2. Adapt to the user's specific constraints
3. Use W#:D# indexing for all workouts
4. Return valid JSON only`
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
```

**Claude Code Prompt:**
```
Create lib/plans/llm-prompts.ts with LLM prompt construction functions.

Implement:
1. buildGenerationSystemPrompt(context) - Creates system prompt:
   - Explain role: coach specializing in template author's methodology
   - List user constraints (weeks, mileage, days, experience)
   - Provide task: adapt template to constraints
   - Key principles to follow
   - Workout indexing format (W#:D#)
   - Output JSON structure with example
   - Workout types list
   - Required fields per workout

2. buildGenerationUserMessage(template) - Creates user message:
   - Include full template JSON
   - Remind about W#:D# indexing
   - Request valid JSON only

3. estimateGenerationTokens(context) - Rough token estimate
   - Combine system + user message lengths
   - Estimate ~4 chars per token

Export all functions.
Use template strings for readability.
```

---

## Task 3: LLM Response Parser

### 3.1 Create JSON Parser and Validator

**File:** `lib/plans/response-parser.ts`

```typescript
export interface ParsedWorkout {
  day: number
  workout_index: string
  type: string
  description: string
  distance_meters: number | null
  duration_minutes: number | null
  intensity: string
  pace_guidance: string | null
  notes: string | null
}

export interface ParsedWeek {
  week_number: number
  phase: string | null
  weekly_total_km: number
  workouts: ParsedWorkout[]
}

export interface ParsedPlan {
  weeks: ParsedWeek[]
}

/**
 * Parse and validate LLM JSON response
 */
export function parseLLMResponse(responseText: string): ParsedPlan {
  // Remove markdown code blocks if present
  let cleanJson = responseText.trim()
  if (cleanJson.startsWith('```json')) {
    cleanJson = cleanJson.replace(/```json\n?/, '').replace(/\n?```$/, '')
  } else if (cleanJson.startsWith('```')) {
    cleanJson = cleanJson.replace(/```\n?/, '').replace(/\n?```$/, '')
  }

  // Parse JSON
  let parsed: any
  try {
    parsed = JSON.parse(cleanJson)
  } catch (error) {
    throw new Error(`Invalid JSON response: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }

  // Validate structure
  if (!parsed.weeks || !Array.isArray(parsed.weeks)) {
    throw new Error('Response missing "weeks" array')
  }

  // Validate each week
  for (const week of parsed.weeks) {
    if (typeof week.week_number !== 'number') {
      throw new Error(`Week missing week_number: ${JSON.stringify(week)}`)
    }

    if (!Array.isArray(week.workouts)) {
      throw new Error(`Week ${week.week_number} missing workouts array`)
    }

    // Validate each workout
    for (const workout of week.workouts) {
      if (typeof workout.day !== 'number' || workout.day < 1 || workout.day > 7) {
        throw new Error(`Invalid day in week ${week.week_number}: ${workout.day}`)
      }

      if (!workout.workout_index || !workout.workout_index.match(/^W\d+:D\d+$/)) {
        throw new Error(`Invalid workout_index in week ${week.week_number}: ${workout.workout_index}`)
      }

      if (!workout.type || typeof workout.type !== 'string') {
        throw new Error(`Missing or invalid type in workout ${workout.workout_index}`)
      }

      if (!workout.description) {
        throw new Error(`Missing description in workout ${workout.workout_index}`)
      }
    }
  }

  return parsed as ParsedPlan
}

/**
 * Calculate workout date from week start and day
 */
export function calculateWorkoutDate(weekStartDate: Date, day: number): string {
  // day: 1=Monday, 7=Sunday
  const workoutDate = new Date(weekStartDate)
  workoutDate.setDate(workoutDate.getDate() + (day - 1))
  return workoutDate.toISOString().split('T')[0]
}

/**
 * Get phase name from week number
 */
export function inferPhase(weekNumber: number, totalWeeks: number): string {
  const progress = weekNumber / totalWeeks

  if (progress <= 0.25) {
    return 'base'
  } else if (progress <= 0.70) {
    return 'build'
  } else if (progress <= 0.85) {
    return 'peak'
  } else {
    return 'taper'
  }
}
```

**Claude Code Prompt:**
```
Create lib/plans/response-parser.ts with LLM response parsing.

Implement:
1. parseLLMResponse(responseText) - Parse and validate JSON:
   - Strip markdown code blocks if present (```json or ```)
   - Parse JSON
   - Validate structure:
     * Has "weeks" array
     * Each week has week_number (number)
     * Each week has workouts array
     * Each workout has:
       - day (1-7)
       - workout_index (W#:D# format, validate regex)
       - type (string)
       - description (string)
   - Throw descriptive errors for validation failures
   - Return ParsedPlan

2. calculateWorkoutDate(weekStartDate, day) - Calculate workout date:
   - day 1 = Monday, 7 = Sunday
   - Add (day - 1) to week start date
   - Return YYYY-MM-DD format

3. inferPhase(weekNumber, totalWeeks) - Infer phase from progress:
   - 0-25%: base
   - 25-70%: build
   - 70-85%: peak
   - 85-100%: taper

Define TypeScript interfaces for ParsedWorkout, ParsedWeek, ParsedPlan.
Export all functions.
```

---

## Task 4: Database Population

### 4.1 Create Database Writer

**File:** `lib/plans/plan-writer.ts`

```typescript
import { supabase } from '@/lib/supabase/client'
import type { ParsedPlan } from './response-parser'
import { calculateWorkoutDate, inferPhase } from './response-parser'

export interface PlanWriteOptions {
  planId: number
  planStartDate: string  // YYYY-MM-DD
  goalDate: string       // YYYY-MM-DD
}

/**
 * Write parsed plan to database
 */
export async function writePlanToDatabase(
  parsedPlan: ParsedPlan,
  options: PlanWriteOptions
) {
  const { planId, planStartDate, goalDate } = options

  // Calculate week start dates
  const planStart = new Date(planStartDate)
  const weekStartDates = parsedPlan.weeks.map(week => {
    const weekStart = new Date(planStart)
    weekStart.setDate(weekStart.getDate() + ((week.week_number - 1) * 7))
    return {
      week_number: week.week_number,
      date: weekStart.toISOString().split('T')[0]
    }
  })

  // Create phases (one phase per traditional period)
  const totalWeeks = parsedPlan.weeks.length
  const phases = [
    { name: 'base', start: 1, end: Math.ceil(totalWeeks * 0.25) },
    { name: 'build', start: Math.ceil(totalWeeks * 0.25) + 1, end: Math.ceil(totalWeeks * 0.70) },
    { name: 'peak', start: Math.ceil(totalWeeks * 0.70) + 1, end: Math.ceil(totalWeeks * 0.85) },
    { name: 'taper', start: Math.ceil(totalWeeks * 0.85) + 1, end: totalWeeks }
  ]

  // Insert phases
  const phaseRecords = []
  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i]
    const startDate = weekStartDates.find(w => w.week_number === phase.start)?.date
    const endDate = weekStartDates.find(w => w.week_number === phase.end)?.date

    if (!startDate || !endDate) continue

    const { data: phaseRecord, error: phaseError } = await supabase
      .from('training_phases')
      .insert({
        plan_id: planId,
        phase_name: phase.name,
        phase_order: i + 1,
        start_date: startDate,
        end_date: endDate,
        description: `${phase.name.charAt(0).toUpperCase() + phase.name.slice(1)} phase`
      })
      .select()
      .single()

    if (phaseError) throw phaseError
    phaseRecords.push({ ...phaseRecord, startWeek: phase.start, endWeek: phase.end })
  }

  // Insert weekly plans and workouts
  for (const week of parsedPlan.weeks) {
    const weekStartDate = weekStartDates.find(w => w.week_number === week.week_number)?.date
    if (!weekStartDate) {
      throw new Error(`Could not find start date for week ${week.week_number}`)
    }

    // Find phase for this week
    const phase = phaseRecords.find(p => 
      week.week_number >= p.startWeek && week.week_number <= p.endWeek
    )

    // Insert weekly plan
    const { data: weeklyPlan, error: weekError } = await supabase
      .from('weekly_plans')
      .insert({
        phase_id: phase?.id || null,
        athlete_id: (await supabase.from('training_plans').select('athlete_id').eq('id', planId).single()).data?.athlete_id,
        week_start_date: weekStartDate,
        week_number: week.week_number,
        weekly_volume_target: week.weekly_total_km * 1000, // Convert to meters
        status: 'planned'
      })
      .select()
      .single()

    if (weekError) throw weekError

    // Insert workouts for this week
    for (const workout of week.workouts) {
      const workoutDate = calculateWorkoutDate(new Date(weekStartDate), workout.day)

      const { error: workoutError } = await supabase
        .from('planned_workouts')
        .insert({
          weekly_plan_id: weeklyPlan.id,
          athlete_id: weeklyPlan.athlete_id,
          scheduled_date: workoutDate,
          workout_type: workout.type,
          workout_index: workout.workout_index,
          description: workout.description,
          distance_target_meters: workout.distance_meters,
          duration_target_seconds: workout.duration_minutes ? workout.duration_minutes * 60 : null,
          intensity_target: workout.intensity,
          structured_workout: {
            pace_guidance: workout.pace_guidance,
            notes: workout.notes
          },
          status: 'scheduled'
        })

      if (workoutError) throw workoutError
    }
  }

  return {
    phases: phaseRecords.length,
    weeks: parsedPlan.weeks.length,
    workouts: parsedPlan.weeks.reduce((sum, w) => sum + w.workouts.length, 0)
  }
}

/**
 * Delete all weekly plans and workouts for a plan (for regeneration)
 */
export async function clearPlanWorkouts(planId: number) {
  // Get athlete_id first
  const { data: plan } = await supabase
    .from('training_plans')
    .select('athlete_id')
    .eq('id', planId)
    .single()

  if (!plan) throw new Error('Plan not found')

  // Delete weekly plans (cascade will delete workouts)
  const { data: weeklyPlans } = await supabase
    .from('weekly_plans')
    .select('id')
    .eq('athlete_id', plan.athlete_id)

  if (weeklyPlans) {
    await supabase
      .from('weekly_plans')
      .delete()
      .in('id', weeklyPlans.map(w => w.id))
  }

  // Delete phases
  await supabase
    .from('training_phases')
    .delete()
    .eq('plan_id', planId)
}
```

**Claude Code Prompt:**
```
Create lib/plans/plan-writer.ts with database writing functions.

Implement:
1. writePlanToDatabase(parsedPlan, options) - Writes plan to DB:
   - Calculate week start dates from plan start date
   - Create 4 phases (base, build, peak, taper) based on week distribution:
     * base: weeks 1-25%
     * build: weeks 25-70%
     * peak: weeks 70-85%
     * taper: weeks 85-100%
   - Insert training_phases records
   - For each week:
     * Insert weekly_plans record with phase_id
     * For each workout:
       - Calculate workout date (week start + day offset)
       - Insert planned_workouts record with:
         * workout_index (W#:D# format)
         * All workout fields
         * structured_workout JSONB with pace_guidance and notes
   - Return summary: { phases, weeks, workouts }

2. clearPlanWorkouts(planId) - Deletes existing plan data:
   - Delete weekly_plans (cascade deletes workouts)
   - Delete training_phases
   - Use for regeneration

Handle errors by throwing.
Use supabase client.
Export all functions.
```

---

## Task 5: Generation API Endpoint

### 5.1 Create Generation Route

**File:** `app/api/plans/generate/route.ts`

```typescript
import { NextResponse } from 'next/server'
import { loadFullTemplate, getTemplateSummary } from '@/lib/templates/template-loader'
import { createDraftPlan, updatePlanStatus } from '@/lib/plans/draft-plan'
import { buildGenerationSystemPrompt, buildGenerationUserMessage } from '@/lib/plans/llm-prompts'
import { parseLLMResponse } from '@/lib/plans/response-parser'
import { writePlanToDatabase, clearPlanWorkouts } from '@/lib/plans/plan-writer'
import { createLLMProvider } from '@/lib/agent/factory'
import { supabase, getCurrentAthleteId } from '@/lib/supabase/client'
import type { UserCriteria } from '@/lib/templates/types'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { template_id, goal_date, goal_type, goal_name, user_criteria } = body

    // Validate request
    if (!template_id || !goal_date || !goal_type || !user_criteria) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Load template summary and full template
    const summary = await getTemplateSummary(template_id)
    if (!summary) {
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 }
      )
    }

    const fullTemplate = await loadFullTemplate(template_id)

    // Create draft plan
    const { plan } = await createDraftPlan({
      template_id,
      template_name: summary.name,
      goal_name,  // Pass through from request (optional)
      goal_date,
      goal_type,
      user_criteria
    })

    // Build LLM prompts
    const context = {
      template: fullTemplate,
      criteria: user_criteria as UserCriteria,
      goal_date
    }

    const systemPrompt = buildGenerationSystemPrompt(context)
    const userMessage = buildGenerationUserMessage(fullTemplate)

    // Call LLM
    const athleteId = getCurrentAthleteId()
    const { data: athlete } = await supabase
      .from('athletes')
      .select('preferred_llm_provider')
      .eq('id', athleteId)
      .single()

    const providerName = athlete?.preferred_llm_provider || 'gemini'
    const provider = createLLMProvider(providerName)

    const response = await provider.generateResponse({
      messages: [{ role: 'user', content: userMessage }],
      systemPrompt,
      maxTokens: 8000,  // Large response needed for full plan
      temperature: 0.7
    })

    // Parse response
    const parsedPlan = parseLLMResponse(response.content)

    // Clear any existing plan data (in case of regeneration)
    await clearPlanWorkouts(plan.id)

    // Write to database
    const writeResult = await writePlanToDatabase(parsedPlan, {
      planId: plan.id,
      planStartDate: plan.start_date.split('T')[0],
      goalDate: goal_date
    })

    // Update plan status to draft_generated
    await updatePlanStatus(plan.id, 'draft_generated')

    return NextResponse.json({
      plan_id: plan.id,
      status: 'draft_generated',
      template_used: summary.name,
      summary: writeResult,
      token_usage: response.usage
    })

  } catch (error) {
    console.error('Error generating plan:', error)
    return NextResponse.json(
      { 
        error: 'Failed to generate plan',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
```

**Claude Code Prompt:**
```
Create app/api/plans/generate/route.ts generation API endpoint.

POST endpoint that:
1. Receives JSON body:
   - template_id
   - goal_date
   - goal_type
   - goal_name (optional)
   - user_criteria

2. Validates required fields (goal_name is optional)

3. Loads template (summary + full template)

4. Creates draft plan in database

5. Builds LLM prompts (system + user message)

6. Gets athlete's preferred LLM provider

7. Calls LLM with provider.generateResponse():
   - messages: [{ role: 'user', content: userMessage }]
   - systemPrompt
   - maxTokens: 8000
   - temperature: 0.7

8. Parses LLM response (parseLLMResponse)

9. Clears existing plan data (in case regenerating)

10. Writes parsed plan to database

11. Updates plan status to 'draft_generated'

12. Returns:
    - plan_id
    - status
    - template_used
    - summary (phases, weeks, workouts count)
    - token_usage

Handle errors with descriptive messages.
Use try/catch with 400/404/500 status codes.
```

---

## Task 6: Generation Page UI

### 6.1 Create Generation Page

**File:** `app/dashboard/plans/generate/page.tsx`

```typescript
'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Loader2, CheckCircle, AlertCircle } from 'lucide-react'

export default function GeneratePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<'loading' | 'generating' | 'success' | 'error'>('loading')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [planId, setPlanId] = useState<number | null>(null)

  useEffect(() => {
    async function generatePlan() {
      try {
        const templateId = searchParams.get('template')
        if (!templateId) {
          setError('No template selected')
          setStatus('error')
          return
        }

        // Get all criteria from previous pages (stored in sessionStorage or pass via query params)
        // For now, get from query params
        const goalDate = searchParams.get('goal_date')
        const goalType = searchParams.get('goal_type')
        const goalName = searchParams.get('goal_name')  // Added from Phase 1 form
        const experienceLevel = searchParams.get('experience')
        const currentMileage = searchParams.get('current')
        const peakMileage = searchParams.get('peak')
        const daysPerWeek = searchParams.get('days')
        const weeksAvailable = searchParams.get('weeks')
        const methodology = searchParams.get('methodology')

        if (!goalDate || !goalType) {
          setError('Missing required criteria')
          setStatus('error')
          return
        }

        const userCriteria = {
          experience_level: experienceLevel,
          current_weekly_mileage: Number(currentMileage),
          comfortable_peak_mileage: Number(peakMileage),
          days_per_week: Number(daysPerWeek),
          weeks_available: Number(weeksAvailable),
          preferred_methodology: methodology
        }

        setStatus('generating')
        setProgress(20)

        // Simulate progress (LLM calls take time)
        const progressInterval = setInterval(() => {
          setProgress(prev => Math.min(prev + 10, 90))
        }, 1000)

        // Call generation API
        const response = await fetch('/api/plans/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            template_id: templateId,
            goal_date: goalDate,
            goal_type: goalType,
            goal_name: goalName,  // Pass through from form
            user_criteria: userCriteria
          })
        })

        clearInterval(progressInterval)
        setProgress(100)

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.details || 'Generation failed')
        }

        const data = await response.json()
        setPlanId(data.plan_id)
        setStatus('success')

        // Navigate to review page after short delay
        setTimeout(() => {
          router.push(`/dashboard/plans/review/${data.plan_id}`)
        }, 1500)

      } catch (err) {
        console.error('Generation error:', err)
        setError(err instanceof Error ? err.message : 'Unknown error')
        setStatus('error')
      }
    }

    generatePlan()
  }, [searchParams, router])

  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {status === 'loading' && (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Preparing...
              </>
            )}
            {status === 'generating' && (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Generating Your Plan
              </>
            )}
            {status === 'success' && (
              <>
                <CheckCircle className="h-5 w-5 text-green-500" />
                Plan Generated!
              </>
            )}
            {status === 'error' && (
              <>
                <AlertCircle className="h-5 w-5 text-destructive" />
                Generation Failed
              </>
            )}
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          {(status === 'loading' || status === 'generating') && (
            <>
              <Progress value={progress} />
              <div className="text-sm text-muted-foreground text-center space-y-1">
                <p>This may take 15-30 seconds...</p>
                <p className="text-xs">
                  {progress < 30 && 'Loading template...'}
                  {progress >= 30 && progress < 60 && 'Adapting to your constraints...'}
                  {progress >= 60 && progress < 90 && 'Building week-by-week schedule...'}
                  {progress >= 90 && 'Finalizing plan...'}
                </p>
              </div>
            </>
          )}

          {status === 'success' && (
            <div className="text-center space-y-2">
              <p className="text-sm text-muted-foreground">
                Your personalized training plan is ready!
              </p>
              <p className="text-xs text-muted-foreground">
                Redirecting to review page...
              </p>
            </div>
          )}

          {status === 'error' && (
            <div className="space-y-4">
              <p className="text-sm text-destructive">{error}</p>
              <Button
                onClick={() => router.back()}
                variant="outline"
                className="w-full"
              >
                Go Back
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
```

**Claude Code Prompt:**
```
Create app/dashboard/plans/generate/page.tsx generation loading page.

Requirements:
1. Read query params:
   - template (required)
   - goal_date, goal_type (required)
   - experience, current, peak, days, weeks, methodology

2. On mount, automatically start generation:
   - Build user_criteria object
   - Call POST /api/plans/generate
   - Show progress indicator (simulate 20% → 90%, then 100% when done)
   - Show status messages: "Loading template...", "Adapting...", "Building schedule...", "Finalizing..."

3. Handle states:
   - loading: Initial state
   - generating: API call in progress
   - success: Plan generated, show success message
   - error: Show error message + "Go Back" button

4. On success:
   - Set planId from response
   - Wait 1.5 seconds
   - Navigate to /dashboard/plans/review/{planId}

5. UI elements:
   - Card with centered content
   - Icon + title (Loader2, CheckCircle, or AlertCircle)
   - Progress bar during generation
   - Status messages
   - Error handling

Use shadcn/ui components.
Use lucide-react icons.
Show estimated time (15-30 seconds).
```

---

## Testing Phase 2

### Manual Testing Checklist

**Test 1: Draft Plan Creation**
- [ ] Open browser dev tools, go to Application > Storage
- [ ] Clear any existing draft plans from DB
- [ ] Navigate through Phase 1 flow (form → recommendations → select template)
- [ ] Verify navigation to `/dashboard/plans/generate?template=...&...`
- [ ] Check database for new record in `training_plans` with status='draft'
- [ ] Check `athlete_goals` record created

**Test 2: Plan Generation**
- [ ] On generate page, verify loading state shows
- [ ] Verify progress bar animates
- [ ] Verify status messages update
- [ ] Wait for generation (15-30 seconds)
- [ ] Verify success state shows
- [ ] Check database:
  - `training_plans` status updated to 'draft_generated'
  - `training_phases` records created (4 phases)
  - `weekly_plans` records created (N weeks)
  - `planned_workouts` records created (multiple per week)
- [ ] Verify all workouts have `workout_index` in W#:D# format
- [ ] Verify navigation to review page happens

**Test 3: Workout Indexing**
- [ ] Query database: `SELECT workout_index FROM planned_workouts ORDER BY scheduled_date`
- [ ] Verify format: W1:D1, W1:D3, W2:D1, etc.
- [ ] Verify week numbers match week_number in weekly_plans
- [ ] Verify day numbers (1-7) correspond to correct weekdays

**Test 4: Different Templates**
- [ ] Generate plan with Hal Higdon template
- [ ] Generate plan with Hansons template
- [ ] Generate plan with Pfitzinger template
- [ ] Verify each maintains that author's philosophy
- [ ] Check workout types reflect methodology (e.g., Hansons has more SOS workouts)

**Test 5: Timeline Compression**
- [ ] Select 18-week template
- [ ] Set user criteria: 12 weeks available
- [ ] Generate plan
- [ ] Verify plan has exactly 12 weeks
- [ ] Verify progression still makes sense (base → build → peak → taper)

**Test 6: Mileage Adaptation**
- [ ] Select template with 70km peak
- [ ] Set user criteria: 55km comfortable peak
- [ ] Generate plan
- [ ] Verify no week exceeds 55km
- [ ] Verify peak week approaches but doesn't exceed limit

**Test 7: Days Per Week Adaptation**
- [ ] Select 6-day template
- [ ] Set user criteria: 5 days per week
- [ ] Generate plan
- [ ] Verify weeks have ≤5 workouts (excluding rest days)

**Test 8: Error Handling**
- [ ] Navigate to generate page without template param
- [ ] Verify error state shows
- [ ] Try with invalid template ID
- [ ] Verify 404 error handling
- [ ] Simulate LLM API failure (disconnect network mid-generation)
- [ ] Verify error message shows

**Test 9: Regeneration**
- [ ] Generate a plan successfully
- [ ] Navigate back and generate again with same template
- [ ] Verify old weekly_plans deleted
- [ ] Verify new data written
- [ ] No duplicate records

**Test 10: LLM Response Parsing**
- [ ] Check server logs for LLM response
- [ ] Verify JSON structure matches expected format
- [ ] Verify all required fields present
- [ ] Verify workout descriptions are meaningful
- [ ] Verify pace guidance included

### Acceptance Criteria

**Must Pass:**
- ✓ Draft plan created in database
- ✓ LLM generation completes successfully
- ✓ All workouts have W#:D# indexing
- ✓ Plan written to database (phases, weekly_plans, planned_workouts)
- ✓ Timeline adapted correctly (compression/extension)
- ✓ Mileage respects comfortable peak limit
- ✓ Training days adapted to user availability
- ✓ Plan status updates to 'draft_generated'
- ✓ Navigation to review page works
- ✓ Error states handled gracefully
- ✓ Multiple template types work (Hal, Hansons, Pfitz)

**Nice to Have:**
- Progress estimation accurate
- Status messages helpful
- LLM responses use good coaching language
- Workout descriptions are specific and actionable

---

## Phase 2 Complete

### Deliverables Checklist
- [ ] Database migrations run (template_id, workout_index columns)
- [ ] `lib/plans/draft-plan.ts` created
- [ ] `lib/plans/llm-prompts.ts` created
- [ ] `lib/plans/response-parser.ts` created
- [ ] `lib/plans/plan-writer.ts` created
- [ ] `app/api/plans/generate/route.ts` created
- [ ] `app/dashboard/plans/generate/page.tsx` created
- [ ] All tests passed
- [ ] Workout indexing verified in database
- [ ] Code committed to git

### What's Next

**Phase 3: Review Interface**
- Create review page layout (60% calendar, 40% chat)
- Integrate calendar to show draft plan
- Display completed activities alongside planned workouts
- Create workout detail modals
- Add navigation and status display

**Reference:** See `MASTER_IMPLEMENTATION_PLAN.md` section "Phase 3: Review Interface"

---

## Troubleshooting

**Issue:** LLM returns invalid JSON
**Fix:** Check parseLLMResponse() error message. Add more examples to system prompt. Increase temperature slightly (0.7 → 0.8).

**Issue:** Workouts missing workout_index
**Fix:** Verify system prompt includes W#:D# format requirement. Check parseLLMResponse() validation.

**Issue:** Timeline not compressed correctly
**Fix:** Check weeks_available in user_criteria. Verify LLM prompt mentions correct target week count.

**Issue:** Mileage exceeds limit
**Fix:** Verify comfortable_peak_mileage in prompt. Add stronger constraint language in system prompt.

**Issue:** Database write fails
**Fix:** Check plan_writer.ts error logs. Verify foreign key relationships (plan_id → phase_id → weekly_plan_id). Check athlete_id is set correctly.

**Issue:** Generation times out
**Fix:** Increase maxTokens if response truncated. Check LLM provider rate limits. Consider using faster model for testing.

---

## End of Phase 2

**Status:** Ready for implementation
**Next Action:** Use Claude Code with provided prompts to implement files sequentially
