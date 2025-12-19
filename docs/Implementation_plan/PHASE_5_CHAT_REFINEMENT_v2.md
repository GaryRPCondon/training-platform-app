# Phase 5: Chat-Based Plan Refinement (Regeneration Architecture)

## Overview

Enable athletes to modify training plans through natural conversation. Modifications work by **regenerating affected weeks** using the same LLM process as initial plan generation, ensuring all constraints (consecutive hard workouts, rest days, phase progression) are maintained.

**Duration**: 6-7 days  
**Complexity**: High (full plan regeneration with modifications)  
**LLM Used**: DeepSeek reasoning model (128K context, 32K output, affordable)

---

## Current Generation Architecture (Review)

### How Plans Are Generated (Phase 2-4)

**File**: `app/api/plans/generate/route.ts`

```typescript
// 1. Load full template
const fullTemplate = await loadFullTemplate(template_id)

// 2. Build comprehensive prompts
const systemPrompt = buildGenerationSystemPrompt({
  template: fullTemplate,  // Full weeks/workouts
  criteria: user_criteria,  // Constraints
  goal_date, start_date, first_day_of_week
})

// 3. Call LLM
const response = await provider.generateResponse({
  messages: [{ role: 'user', content: userMessage }],
  systemPrompt,
  maxTokens: 32768,  // DeepSeek supports 32K output
  temperature: 0.7
})

// 4. Parse & validate
const parsedPlan = parseLLMResponse(response.content)

// 5. Write to database atomically
await writePlanToDatabase(parsedPlan, options)
```

**Key Insight**: The LLM generates the **entire plan structure** in JSON, enforcing:
- No consecutive hard workouts (unless template explicitly allows)
- Rest day preferences respected
- Phase volume progression
- Workout type distribution

**This same process will power modifications.**

---

## Phase 5 Architecture: Scoped Regeneration

### Core Concept

**Modifications = Regenerate Affected Weeks with New Instructions**

```
User: "Move all rest days to Fridays"
  ↓
Parse Intent
  - Type: pattern_reschedule
  - Scope: entire_plan (weeks 1-18)
  - Modification: rest days → Fridays
  ↓
Load Full Plan Context
  - All 126 current workouts
  - Original template used
  - User criteria/constraints
  - VDOT / training paces
  ↓
Build Regeneration Prompt
  System: "You are modifying an existing plan..."
  Context: {current plan structure}
  Request: "Regenerate weeks 1-18 with rest days on Fridays"
  Constraints: "Maintain phase structure, volume targets, workout types"
  ↓
Call LLM (DeepSeek)
  Input: ~25K tokens (full context)
  Output: ~10K tokens (regenerated weeks)
  ↓
Parse & Validate
  - Check all constraints met
  - Verify no consecutive hard workouts
  - Confirm rest days on Fridays
  ↓
Show Preview
  - Before/After side-by-side
  - Highlight all changes
  - Show volume impact
  ↓
User Approves
  ↓
Atomic Replace
  DELETE FROM planned_workouts WHERE week_number IN (1..18)
  INSERT regenerated workouts
  ↓
UI Refreshes
```

---

## Token Budget Verification

**DeepSeek Reasoning Model**: 128K context, 32K output

**Input Tokens (Modification Request)**:
- System prompt: 8K (role, rules, constraints)
- Current plan structure: 12K (all 126 workouts)
- Template philosophy: 3K (from original template)
- Conversation history: 5K (last 10 messages)
- User request: 0.5K
- **Total: ~28.5K tokens** ✅ Fits comfortably

**Output Tokens (Regenerated Plan)**:
- Regenerated weeks: 10-15K tokens
- **Total: ~15K tokens** ✅ Well under 32K limit

**Verdict**: Full plan context works perfectly with DeepSeek ✅

---

## Implementation Tasks

### Task 5.1: Full Plan Context Loader
### Task 5.2: Intent Parser & Scope Identifier  
### Task 5.3: Regeneration Prompt Builder
### Task 5.4: Regeneration API Route
### Task 5.5: Plan Diff & Preview UI
### Task 5.6: Atomic Database Replace
### Task 5.7: Chat Interface Integration
### Task 5.8: Testing & Validation

---

## Task 5.1: Full Plan Context Loader

Load complete plan structure for LLM context.

**File**: `lib/chat/plan-context-loader.ts`

```typescript
import { supabase, getCurrentAthleteId } from '@/lib/supabase/client'
import { loadFullTemplate } from '@/lib/templates/template-loader'

export interface FullPlanContext {
  plan: {
    id: number
    name: string
    goal_date: string
    start_date: string
    vdot: number | null
    training_paces: any
    template_id: string
    user_criteria: any
  }
  template: any  // Original template used
  phases: Array<{
    phase_name: string
    phase_order: number
    start_date: string
    end_date: string
  }>
  weeks: Array<{
    week_number: number
    week_start_date: string
    phase_name: string
    weekly_volume_km: number
    workouts: Array<{
      workout_index: string
      day: number
      scheduled_date: string
      workout_type: string
      description: string
      distance_km: number | null
      intensity_target: string
      pace_guidance: string | null
      status: string
    }>
  }>
  athlete_constraints: {
    preferred_rest_days: number[]
    comfortable_peak_mileage: number
    current_weekly_mileage: number
    days_per_week: number
  }
}

export async function loadFullPlanContext(
  planId: number
): Promise<FullPlanContext> {
  const athleteId = getCurrentAthleteId()
  
  // Load plan with all relationships
  const { data: plan, error: planError } = await supabase
    .from('training_plans')
    .select(`
      id, name, goal_date, start_date, plan_type,
      vdot, training_paces, pace_source, pace_source_data,
      template_id, template_version, user_criteria,
      training_phases (
        id, phase_name, phase_order, start_date, end_date,
        weekly_plans (
          id, week_number, week_start_date, weekly_volume_target,
          planned_workouts (
            id, workout_index, scheduled_date, workout_type,
            description, distance_target_meters, intensity_target,
            structured_workout, status
          )
        )
      )
    `)
    .eq('id', planId)
    .eq('athlete_id', athleteId)
    .single()
  
  if (planError) throw planError
  
  // Load original template
  const template = await loadFullTemplate(plan.template_id)
  
  // Flatten structure for easier consumption
  const phases = plan.training_phases.map(p => ({
    phase_name: p.phase_name,
    phase_order: p.phase_order,
    start_date: p.start_date,
    end_date: p.end_date
  }))
  
  const weeks = plan.training_phases.flatMap(phase =>
    phase.weekly_plans.map(week => ({
      week_number: week.week_number,
      week_start_date: week.week_start_date,
      phase_name: phase.phase_name,
      weekly_volume_km: week.weekly_volume_target / 1000,
      workouts: week.planned_workouts.map(w => ({
        workout_index: w.workout_index,
        day: getDayNumber(w.scheduled_date, week.week_start_date),
        scheduled_date: w.scheduled_date,
        workout_type: w.workout_type,
        description: w.description,
        distance_km: w.distance_target_meters ? w.distance_target_meters / 1000 : null,
        intensity_target: w.intensity_target,
        pace_guidance: w.structured_workout?.pace_guidance || null,
        status: w.status
      }))
    }))
  ).sort((a, b) => a.week_number - b.week_number)
  
  // Extract athlete constraints from user_criteria
  const criteria = plan.user_criteria || {}
  
  return {
    plan: {
      id: plan.id,
      name: plan.name,
      goal_date: plan.goal_date,
      start_date: plan.start_date,
      vdot: plan.vdot,
      training_paces: plan.training_paces,
      template_id: plan.template_id,
      user_criteria: plan.user_criteria
    },
    template,
    phases,
    weeks,
    athlete_constraints: {
      preferred_rest_days: criteria.preferred_rest_days || [],
      comfortable_peak_mileage: criteria.comfortable_peak_mileage || 80,
      current_weekly_mileage: criteria.current_weekly_mileage || 30,
      days_per_week: criteria.days_per_week || 5
    }
  }
}

function getDayNumber(workoutDate: string, weekStart: string): number {
  const diff = new Date(workoutDate).getTime() - new Date(weekStart).getTime()
  return Math.floor(diff / (1000 * 60 * 60 * 24)) + 1
}

export function formatContextForLLM(context: FullPlanContext): string {
  let formatted = `# Current Training Plan\n\n`
  
  formatted += `**Plan**: ${context.plan.name}\n`
  formatted += `**Goal Date**: ${context.plan.goal_date}\n`
  formatted += `**Total Weeks**: ${context.weeks.length}\n`
  if (context.plan.vdot) {
    formatted += `**VDOT**: ${context.plan.vdot}\n`
  }
  formatted += `\n`
  
  // Phases
  formatted += `## Phase Structure\n\n`
  for (const phase of context.phases) {
    const weekCount = context.weeks.filter(w => w.phase_name === phase.phase_name).length
    formatted += `- **${phase.phase_name}**: ${weekCount} weeks (${phase.start_date} to ${phase.end_date})\n`
  }
  formatted += `\n`
  
  // Constraints
  formatted += `## Athlete Constraints\n\n`
  if (context.athlete_constraints.preferred_rest_days.length > 0) {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const restDays = context.athlete_constraints.preferred_rest_days.map(d => dayNames[d]).join(', ')
    formatted += `- **Required Rest Days**: ${restDays}\n`
  }
  formatted += `- **Comfortable Peak Mileage**: ${context.athlete_constraints.comfortable_peak_mileage}km\n`
  formatted += `- **Training Days per Week**: ${context.athlete_constraints.days_per_week}\n`
  formatted += `\n`
  
  // All workouts (condensed format)
  formatted += `## Current Plan Structure (All Workouts)\n\n`
  for (const week of context.weeks) {
    formatted += `### Week ${week.week_number} - ${week.phase_name} (${week.weekly_volume_km.toFixed(1)}km)\n\n`
    for (const workout of week.workouts) {
      formatted += `- **${workout.workout_index}** (Day ${workout.day}): `
      formatted += `${workout.workout_type} `
      if (workout.distance_km) {
        formatted += `${workout.distance_km.toFixed(1)}km `
      }
      formatted += `[${workout.intensity_target}]`
      if (workout.description !== workout.workout_type) {
        formatted += ` - ${workout.description}`
      }
      formatted += `\n`
    }
    formatted += `\n`
  }
  
  return formatted
}
```

**Acceptance Criteria**:
- ✅ Loads complete plan with all nested data
- ✅ Loads original template
- ✅ Flattens structure for easier LLM consumption
- ✅ Formats as readable text (~12K tokens)
- ✅ Includes all constraints

---

## Task 5.2: Intent Parser & Scope Identifier

Parse user intent and determine which weeks need regeneration.

**File**: `lib/chat/intent-parser.ts`

```typescript
import { parseWorkoutReferences } from './workout-reference-parser'

export interface ModificationIntent {
  type: 'pattern_reschedule' | 'pattern_replace' | 'insert_gap' | 
        'insert_race' | 'adjust_intensity' | 'single_workout'
  scope: 'entire_plan' | 'single_week' | 'week_range' | 'specific_workouts'
  affected_weeks: number[]
  modifications: any
  description: string
}

export function parseUserIntent(
  userMessage: string,
  totalWeeks: number
): ModificationIntent | null {
  
  const lower = userMessage.toLowerCase()
  
  // Pattern: "all rest days to Fridays"
  if (lower.includes('all') && lower.includes('rest') && 
      (lower.includes('friday') || lower.includes('fridays'))) {
    return {
      type: 'pattern_reschedule',
      scope: 'entire_plan',
      affected_weeks: Array.from({length: totalWeeks}, (_, i) => i + 1),
      modifications: {
        pattern: { workout_type: 'rest' },
        target: { day_of_week: 5 }
      },
      description: 'Move all rest days to Fridays'
    }
  }
  
  // Pattern: "long runs on Saturdays"
  if (lower.includes('long run') && 
      (lower.includes('saturday') || lower.includes('saturdays'))) {
    return {
      type: 'pattern_reschedule',
      scope: 'entire_plan',
      affected_weeks: Array.from({length: totalWeeks}, (_, i) => i + 1),
      modifications: {
        pattern: { workout_type: 'long_run' },
        target: { day_of_week: 6 }
      },
      description: 'Move all long runs to Saturdays'
    }
  }
  
  // Pattern: "replace intervals with tempo"
  if ((lower.includes('replace') || lower.includes('swap')) &&
      (lower.includes('interval') || lower.includes('sprint')) &&
      lower.includes('tempo')) {
    return {
      type: 'pattern_replace',
      scope: 'entire_plan',
      affected_weeks: Array.from({length: totalWeeks}, (_, i) => i + 1),
      modifications: {
        find: { workout_type: 'intervals' },
        replace_with: { workout_type: 'tempo', distance_factor: 1.2 }
      },
      description: 'Replace all interval sessions with tempo runs'
    }
  }
  
  // Week-specific: "make week 5 easier"
  const weekMatch = lower.match(/week (\d+)/i)
  if (weekMatch && (lower.includes('easier') || lower.includes('reduce') || lower.includes('recover'))) {
    const weekNum = parseInt(weekMatch[1])
    return {
      type: 'adjust_intensity',
      scope: 'single_week',
      affected_weeks: [weekNum],
      modifications: {
        strategy: 'recovery_week',
        volume_factor: 0.7
      },
      description: `Make week ${weekNum} a recovery week`
    }
  }
  
  // Check for W#:D# references (single workout)
  const references = parseWorkoutReferences(userMessage)
  if (references.length > 0) {
    const weeks = [...new Set(references.map(r => r.week))]
    return {
      type: 'single_workout',
      scope: weeks.length === 1 ? 'single_week' : 'specific_workouts',
      affected_weeks: weeks,
      modifications: {
        workouts: references.map(r => r.index)
      },
      description: `Modify workouts: ${references.map(r => r.index).join(', ')}`
    }
  }
  
  // Couldn't parse - LLM will handle in conversation
  return null
}
```

**File**: `lib/chat/workout-reference-parser.ts` (from earlier)

```typescript
export interface WorkoutReference {
  original: string
  week: number
  day: number
  index: string  // W#:D# format
}

export function parseWorkoutReferences(text: string): WorkoutReference[] {
  const references: WorkoutReference[] = []
  
  // Pattern: W#:D#
  const pattern1 = /W(\d+):D(\d+)/gi
  let match
  while ((match = pattern1.exec(text)) !== null) {
    references.push({
      original: match[0],
      week: parseInt(match[1]),
      day: parseInt(match[2]),
      index: `W${match[1]}:D${match[2]}`
    })
  }
  
  // Pattern: "Week # Day #"
  const pattern2 = /week\s+(\d+)\s+day\s+(\d+)/gi
  while ((match = pattern2.exec(text)) !== null) {
    const ref = {
      original: match[0],
      week: parseInt(match[1]),
      day: parseInt(match[2]),
      index: `W${match[1]}:D${match[2]}`
    }
    if (!references.some(r => r.index === ref.index)) {
      references.push(ref)
    }
  }
  
  return references
}
```

**Acceptance Criteria**:
- ✅ Parses "all X to Y" patterns
- ✅ Parses "replace X with Y" patterns
- ✅ Parses week-specific modifications
- ✅ Parses W#:D# references
- ✅ Identifies affected weeks correctly
- ✅ Returns null for ambiguous requests (LLM handles in chat)

---

## Task 5.3: Regeneration Prompt Builder

Build prompts for scoped plan regeneration.

**File**: `lib/chat/regeneration-prompts.ts`

```typescript
import type { FullPlanContext } from './plan-context-loader'
import type { ModificationIntent } from './intent-parser'
import { formatContextForLLM } from './plan-context-loader'

export function buildRegenerationSystemPrompt(
  context: FullPlanContext,
  intent: ModificationIntent
): string {
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  
  return `You are a running coach modifying an existing training plan.

# CURRENT PLAN CONTEXT

${formatContextForLLM(context)}

# MODIFICATION REQUEST

${intent.description}

**Affected Weeks**: ${intent.affected_weeks.join(', ')}

# YOUR TASK

Regenerate weeks ${intent.affected_weeks.join(', ')} with the following modification:

${formatModificationDetails(intent)}

# CRITICAL CONSTRAINTS - MUST FOLLOW

1. **Maintain Template Philosophy**: The original template was ${context.template.name}. Preserve its training philosophy and progression patterns.

2. **No Consecutive Hard Workouts**: NEVER place hard workouts (long_run, intervals, tempo, intensity=hard/moderate) on consecutive days UNLESS the original template explicitly does this.

3. **Respect Rest Day Preferences**: ${context.athlete_constraints.preferred_rest_days.length > 0 ? 
   `Athlete MUST rest on: ${context.athlete_constraints.preferred_rest_days.map(d => dayNames[d]).join(', ')}` :
   'No specific rest day requirements'}

4. **Maintain Phase Structure**: Keep the same phase assignments (${context.phases.map(p => p.phase_name).join(', ')}) unless modification explicitly changes them.

5. **Preserve Volume Targets**: Keep weekly volumes similar to original unless modification explicitly changes intensity.

6. **Use W#:D# Indexing**: Every workout MUST have workout_index in format W{week}:D{day}

7. **Distance-Only Prescriptions**: Do NOT include duration_minutes or duration_seconds. System calculates from distance + athlete's pace.

# OUTPUT FORMAT

Return ONLY valid JSON (no markdown, no explanations):

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
          "description": "Easy aerobic run",
          "distance_meters": 8000,
          "intensity": "easy",
          "pace_guidance": "Conversational pace",
          "notes": "Focus on form"
        }
      ]
    }
  ]
}

Regenerate ONLY weeks ${intent.affected_weeks.join(', ')}. Return complete workout structures for these weeks.`
}

function formatModificationDetails(intent: ModificationIntent): string {
  switch (intent.type) {
    case 'pattern_reschedule':
      const pattern = intent.modifications.pattern
      const target = intent.modifications.target
      return `- Find all workouts with type="${pattern.workout_type}"
- Reschedule them to day ${target.day_of_week} of each week
- Adjust other workouts to maintain proper spacing (no consecutive hard days)`
    
    case 'pattern_replace':
      const find = intent.modifications.find
      const replace = intent.modifications.replace_with
      return `- Find all workouts with type="${find.workout_type}"
- Replace with type="${replace.workout_type}"
${replace.distance_factor ? `- Adjust distances by factor ${replace.distance_factor}x` : ''}
- Maintain intensity distribution across the week`
    
    case 'adjust_intensity':
      const strategy = intent.modifications.strategy
      const factor = intent.modifications.volume_factor || 0.7
      return `- Reduce weekly volume to ${(factor * 100).toFixed(0)}% of original
- Keep workout types the same
- Reduce distances proportionally
- This is a recovery week`
    
    case 'insert_gap':
      return `- Convert specified week to easy recovery runs only
- Extend plan by 1 week at the end
- Shift remaining weeks accordingly`
    
    case 'insert_race':
      const race = intent.modifications
      return `- Insert race on specified date
- Add ${race.taper_days}-day taper before race
- Add ${race.recovery_days}-day recovery after race`
    
    case 'single_workout':
      return `- Modify specified workout(s) per athlete request
- Maintain week structure otherwise`
    
    default:
      return '- Apply requested modification'
  }
}

export function buildRegenerationUserMessage(
  context: FullPlanContext,
  intent: ModificationIntent,
  userRequest: string
): string {
  return `Here is the athlete's request in their own words:

"${userRequest}"

Please regenerate weeks ${intent.affected_weeks.join(', ')} incorporating this modification while maintaining all training principles and constraints.

Original template used: ${context.template.name}

Return ONLY the JSON structure for the regenerated weeks.`
}
```

**Acceptance Criteria**:
- ✅ Includes full plan context
- ✅ Clearly states modification request
- ✅ Lists all constraints
- ✅ Specifies which weeks to regenerate
- ✅ Requests JSON-only output
- ✅ Maintains template philosophy

---

## Task 5.4: Regeneration API Route

**File**: `app/api/chat/regenerate/route.ts`

```typescript
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { loadFullPlanContext } from '@/lib/chat/plan-context-loader'
import { parseUserIntent } from '@/lib/chat/intent-parser'
import { buildRegenerationSystemPrompt, buildRegenerationUserMessage } from '@/lib/chat/regeneration-prompts'
import { createLLMProvider } from '@/lib/agent/factory'
import { parseLLMResponse } from '@/lib/plans/response-parser'

export async function POST(request: Request) {
  try {
    const { plan_id, user_message, session_id } = await request.json()
    
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }
    
    // Load full plan context
    const context = await loadFullPlanContext(plan_id)
    
    // Parse user intent
    const intent = parseUserIntent(user_message, context.weeks.length)
    
    if (!intent) {
      // Ambiguous request - return for conversational clarification
      return NextResponse.json({
        needs_clarification: true,
        message: "I'm not sure I understood. Could you be more specific about what you'd like to change?"
      })
    }
    
    // Build regeneration prompts
    const systemPrompt = buildRegenerationSystemPrompt(context, intent)
    const userPromptMessage = buildRegenerationUserMessage(context, intent, user_message)
    
    // Get LLM provider
    const { data: athlete } = await supabase
      .from('athletes')
      .select('preferred_llm_provider, preferred_llm_model')
      .eq('id', user.id)
      .single()
    
    const providerName = athlete?.preferred_llm_provider || 'deepseek'
    const modelName = athlete?.preferred_llm_model || undefined
    const provider = createLLMProvider(providerName, modelName)
    
    // Call LLM for regeneration
    const response = await provider.generateResponse({
      messages: [{ role: 'user', content: userPromptMessage }],
      systemPrompt,
      maxTokens: 32768,
      temperature: 0.7
    })
    
    // Parse regenerated weeks
    const parsedPlan = parseLLMResponse(response.content)
    
    // Validate affected weeks match
    const regeneratedWeeks = parsedPlan.weeks.map(w => w.week_number)
    const expectedWeeks = intent.affected_weeks
    
    const missingWeeks = expectedWeeks.filter(w => !regeneratedWeeks.includes(w))
    if (missingWeeks.length > 0) {
      throw new Error(`LLM failed to regenerate weeks: ${missingWeeks.join(', ')}`)
    }
    
    // Return for preview (not applied yet)
    return NextResponse.json({
      success: true,
      intent,
      regenerated_weeks: parsedPlan.weeks,
      affected_weeks: intent.affected_weeks,
      token_usage: response.usage
    })
    
  } catch (error) {
    console.error('Regeneration error:', error)
    return NextResponse.json(
      { error: 'Regeneration failed', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    )
  }
}
```

**Acceptance Criteria**:
- ✅ Loads full plan context
- ✅ Parses user intent
- ✅ Builds regeneration prompts
- ✅ Calls LLM with full context
- ✅ Parses and validates output
- ✅ Returns regenerated weeks for preview
- ✅ Does NOT apply changes yet

---

## Task 5.5: Plan Diff & Preview UI

Show before/after comparison of regenerated weeks.

**File**: `components/chat/plan-diff-preview.tsx`

```typescript
'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ArrowRight, CheckCircle2, AlertCircle } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'

interface Props {
  beforeWeeks: any[]
  afterWeeks: any[]
  affectedWeeks: number[]
  onApprove: () => void
  onReject: () => void
  loading?: boolean
}

export function PlanDiffPreview({ 
  beforeWeeks, 
  afterWeeks, 
  affectedWeeks,
  onApprove,
  onReject,
  loading 
}: Props) {
  
  const changes = calculateChanges(beforeWeeks, afterWeeks, affectedWeeks)
  
  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertCircle className="h-5 w-5" />
          Plan Modification Preview
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {affectedWeeks.length} week(s) will be regenerated
        </p>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Summary */}
        <div className="grid grid-cols-3 gap-4 p-4 bg-muted rounded-lg">
          <div>
            <div className="text-sm text-muted-foreground">Workouts Changed</div>
            <div className="text-2xl font-bold">{changes.workoutCount}</div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Volume Change</div>
            <div className="text-2xl font-bold">
              {changes.volumeChange > 0 ? '+' : ''}
              {changes.volumeChange.toFixed(1)}km
            </div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Weeks Affected</div>
            <div className="text-2xl font-bold">{affectedWeeks.length}</div>
          </div>
        </div>
        
        {/* Week-by-week comparison */}
        <ScrollArea className="h-[400px]">
          {affectedWeeks.map(weekNum => {
            const before = beforeWeeks.find(w => w.week_number === weekNum)
            const after = afterWeeks.find(w => w.week_number === weekNum)
            
            return (
              <WeekComparison 
                key={weekNum}
                weekNumber={weekNum}
                before={before}
                after={after}
              />
            )
          })}
        </ScrollArea>
        
        {/* Actions */}
        <div className="flex gap-2 justify-end">
          <Button
            variant="outline"
            onClick={onReject}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            onClick={onApprove}
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Applying...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Apply Changes
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function WeekComparison({ weekNumber, before, after }: any) {
  return (
    <div className="border rounded-lg p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <Badge>Week {weekNumber}</Badge>
        <span className="text-sm text-muted-foreground">
          {before?.phase_name || after?.phase_name}
        </span>
      </div>
      
      <div className="grid grid-cols-2 gap-4">
        {/* Before */}
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-2">Before</div>
          <div className="space-y-1">
            {before?.workouts.map((w: any) => (
              <WorkoutLine key={w.workout_index} workout={w} />
            ))}
          </div>
        </div>
        
        {/* Arrow */}
        <div className="flex items-center justify-center">
          <ArrowRight className="h-6 w-6 text-muted-foreground" />
        </div>
        
        {/* After */}
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-2">After</div>
          <div className="space-y-1">
            {after?.workouts.map((w: any) => (
              <WorkoutLine key={w.workout_index} workout={w} highlight />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function WorkoutLine({ workout, highlight }: { workout: any; highlight?: boolean }) {
  return (
    <div className={`text-sm ${highlight ? 'bg-yellow-50 px-2 py-1 rounded' : ''}`}>
      <span className="font-mono text-xs">{workout.workout_index}</span>
      {' '}
      <span className="font-medium">{workout.workout_type}</span>
      {' '}
      {workout.distance_km && (
        <span className="text-muted-foreground">{workout.distance_km.toFixed(1)}km</span>
      )}
      {' '}
      <Badge variant="outline" className="text-xs">
        {workout.intensity_target}
      </Badge>
    </div>
  )
}

function calculateChanges(before: any[], after: any[], affected: number[]) {
  const beforeWorkouts = before
    .filter(w => affected.includes(w.week_number))
    .flatMap(w => w.workouts)
  
  const afterWorkouts = after
    .filter(w => affected.includes(w.week_number))
    .flatMap(w => w.workouts)
  
  const beforeVolume = beforeWorkouts.reduce((sum, w) => sum + (w.distance_km || 0), 0)
  const afterVolume = afterWorkouts.reduce((sum, w) => sum + (w.distance_km || 0), 0)
  
  return {
    workoutCount: afterWorkouts.length,
    volumeChange: afterVolume - beforeVolume
  }
}
```

**Acceptance Criteria**:
- ✅ Shows week-by-week before/after
- ✅ Highlights changes
- ✅ Shows summary metrics
- ✅ Approve/reject buttons
- ✅ Scrollable for many weeks

---

## Task 5.6: Atomic Database Replace

Replace workouts for affected weeks atomically.

**File**: `lib/chat/plan-replacer.ts`

```typescript
import { SupabaseClient } from '@supabase/supabase-js'
import { writePlanToDatabase, clearPlanWorkouts } from '@/lib/plans/plan-writer'
import type { ParsedPlan } from '@/lib/plans/response-parser'

export async function replaceAffectedWeeks(
  planId: number,
  regeneratedWeeks: any[],
  affectedWeekNumbers: number[],
  supabase: SupabaseClient
): Promise<void> {
  
  // Get plan details
  const { data: plan } = await supabase
    .from('training_plans')
    .select('athlete_id, start_date, goal_date')
    .eq('id', planId)
    .single()
  
  if (!plan) throw new Error('Plan not found')
  
  // Start transaction (Supabase doesn't have explicit transactions, but we can batch)
  
  // 1. Delete workouts for affected weeks
  const { data: weeklyPlans } = await supabase
    .from('weekly_plans')
    .select('id')
    .eq('athlete_id', plan.athlete_id)
    .in('week_number', affectedWeekNumbers)
  
  if (weeklyPlans && weeklyPlans.length > 0) {
    // Delete planned_workouts (cascade should handle this, but explicit is safer)
    for (const weekPlan of weeklyPlans) {
      await supabase
        .from('planned_workouts')
        .delete()
        .eq('weekly_plan_id', weekPlan.id)
    }
    
    // Delete weekly_plans
    await supabase
      .from('weekly_plans')
      .delete()
      .in('id', weeklyPlans.map(w => w.id))
  }
  
  // 2. Insert regenerated workouts
  // We need to create weekly_plans and planned_workouts for affected weeks
  
  // Get phase info for affected weeks
  const { data: phases } = await supabase
    .from('training_phases')
    .select('*')
    .eq('plan_id', planId)
    .order('phase_order')
  
  if (!phases) throw new Error('Phases not found')
  
  // Calculate week start dates
  const planStart = new Date(plan.start_date)
  
  for (const week of regeneratedWeeks) {
    // Calculate week start date
    const weekStart = new Date(planStart)
    weekStart.setDate(planStart.getDate() + (week.week_number - 1) * 7)
    const weekStartDate = weekStart.toISOString().split('T')[0]
    
    // Find phase for this week
    const phase = phases.find(p => {
      const phaseStart = new Date(p.start_date)
      const phaseEnd = new Date(p.end_date)
      const weekDate = new Date(weekStartDate)
      return weekDate >= phaseStart && weekDate <= phaseEnd
    })
    
    // Create weekly_plan
    const { data: weeklyPlan, error: weekError } = await supabase
      .from('weekly_plans')
      .insert({
        phase_id: phase?.id || null,
        athlete_id: plan.athlete_id,
        week_start_date: weekStartDate,
        week_number: week.week_number,
        weekly_volume_target: week.weekly_total_km * 1000,
        status: 'planned'
      })
      .select()
      .single()
    
    if (weekError) throw weekError
    
    // Insert workouts
    for (const workout of week.workouts) {
      const workoutDate = new Date(weekStart)
      workoutDate.setDate(workoutDate.getDate() + (workout.day - 1))
      const workoutDateStr = workoutDate.toISOString().split('T')[0]
      
      const { error: workoutError } = await supabase
        .from('planned_workouts')
        .insert({
          weekly_plan_id: weeklyPlan.id,
          athlete_id: plan.athlete_id,
          scheduled_date: workoutDateStr,
          workout_type: workout.type,
          workout_index: workout.workout_index,
          description: workout.description,
          distance_target_meters: workout.distance_meters,
          duration_target_seconds: null,
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
  
  console.log(`Successfully replaced ${affectedWeekNumbers.length} weeks with ${regeneratedWeeks.length} regenerated weeks`)
}
```

**File**: `app/api/chat/apply-changes/route.ts`

```typescript
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { replaceAffectedWeeks } from '@/lib/chat/plan-replacer'

export async function POST(request: Request) {
  try {
    const { plan_id, regenerated_weeks, affected_weeks } = await request.json()
    
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }
    
    // Apply changes atomically
    await replaceAffectedWeeks(
      plan_id,
      regenerated_weeks,
      affected_weeks,
      supabase
    )
    
    return NextResponse.json({ success: true })
    
  } catch (error) {
    console.error('Apply changes error:', error)
    return NextResponse.json(
      { error: 'Failed to apply changes', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    )
  }
}
```

**Acceptance Criteria**:
- ✅ Deletes old workouts for affected weeks
- ✅ Inserts regenerated workouts
- ✅ Maintains phase linkages
- ✅ Calculates correct dates
- ✅ Atomic operation (all or nothing)
- ✅ Error handling and rollback

---

## Task 5.7: Chat Interface Integration

Add chat UI to review page.

**File**: `app/dashboard/plans/review/[planId]/page.tsx` (UPDATE)

```typescript
// Add to imports
import { PlanChat } from '@/components/chat/plan-chat'
import { MessageSquare } from 'lucide-react'

// Add state
const [showChat, setShowChat] = useState(false)

// Add button to header
<Button
  variant={showChat ? 'default' : 'outline'}
  onClick={() => setShowChat(!showChat)}
>
  <MessageSquare className="h-4 w-4 mr-2" />
  {showChat ? 'Hide Chat' : 'Discuss Plan'}
</Button>

// Add chat panel
{showChat && (
  <div className="mt-6">
    <PlanChat
      planId={parseInt(planId)}
      onPlanModified={() => {
        queryClient.invalidateQueries({ queryKey: ['plan-review', planId] })
      }}
    />
  </div>
)}
```

**File**: `components/chat/plan-chat.tsx`

```typescript
'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { PlanDiffPreview } from './plan-diff-preview'
import { Loader2, Send } from 'lucide-react'

interface Props {
  planId: number
  onPlanModified: () => void
}

export function PlanChat({ planId, onPlanModified }: Props) {
  const [input, setInput] = useState('')
  const [previewData, setPreviewData] = useState<any>(null)
  const queryClient = useQueryClient()
  
  // Regenerate mutation
  const regenerate = useMutation({
    mutationFn: async (message: string) => {
      const response = await fetch('/api/chat/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan_id: planId,
          user_message: message
        })
      })
      
      if (!response.ok) throw new Error('Regeneration failed')
      return response.json()
    },
    onSuccess: (data) => {
      if (data.needs_clarification) {
        // Show clarification message
        alert(data.message)
      } else {
        // Show preview
        setPreviewData(data)
      }
      setInput('')
    }
  })
  
  // Apply changes mutation
  const applyChanges = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/chat/apply-changes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan_id: planId,
          regenerated_weeks: previewData.regenerated_weeks,
          affected_weeks: previewData.affected_weeks
        })
      })
      
      if (!response.ok) throw new Error('Failed to apply changes')
      return response.json()
    },
    onSuccess: () => {
      setPreviewData(null)
      onPlanModified()
      alert('Changes applied successfully!')
    }
  })
  
  const handleSend = () => {
    if (!input.trim()) return
    regenerate.mutate(input)
  }
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Modify Your Plan</CardTitle>
        <p className="text-sm text-muted-foreground">
          Examples: "Move all rest days to Fridays" | "Make week 5 easier" | "Replace intervals with tempo"
        </p>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Preview if available */}
        {previewData && (
          <PlanDiffPreview
            beforeWeeks={/* need to load current plan */}
            afterWeeks={previewData.regenerated_weeks}
            affectedWeeks={previewData.affected_weeks}
            onApprove={() => applyChanges.mutate()}
            onReject={() => setPreviewData(null)}
            loading={applyChanges.isPending}
          />
        )}
        
        {/* Input */}
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="What would you like to change about your plan?"
            className="min-h-[100px]"
            disabled={regenerate.isPending || !!previewData}
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || regenerate.isPending || !!previewData}
            size="icon"
            className="h-[100px] w-12"
          >
            {regenerate.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
```

**Acceptance Criteria**:
- ✅ Chat button in review page header
- ✅ Input for modification requests
- ✅ Shows regeneration preview
- ✅ Apply/reject workflow
- ✅ Refreshes plan after changes
- ✅ Loading states

---

## Task 5.8: Testing & Validation

**Manual Test Scenarios**:

1. **Pattern Reschedule - All Rest Days**
   - Input: "Move all rest days to Fridays"
   - Verify: All 18 weeks regenerated, rest on day 5
   - Check: No consecutive hard workouts

2. **Pattern Reschedule - Long Runs**
   - Input: "Long runs on Saturdays"
   - Verify: All long runs on day 6
   - Check: Proper recovery days before

3. **Pattern Replace - Intervals to Tempo**
   - Input: "Replace intervals with tempo runs"
   - Verify: All intervals → tempo
   - Check: Distances adjusted appropriately

4. **Single Week Adjustment**
   - Input: "Make week 5 easier"
   - Verify: Only week 5 regenerated
   - Check: Volume reduced ~30%

5. **Ambiguous Request**
   - Input: "Change some workouts"
   - Verify: Clarification requested
   - Check: No regeneration triggered

6. **Token Budget**
   - Load 18-week plan
   - Request modification
   - Verify: Input <30K tokens, output <20K

**Database Verification**:

```sql
-- Check affected weeks were replaced
SELECT week_number, COUNT(*) as workout_count
FROM planned_workouts pw
JOIN weekly_plans wp ON wp.id = pw.weekly_plan_id
WHERE wp.plan_id = ?
GROUP BY week_number
ORDER BY week_number;

-- Verify no duplicate workout indices
SELECT workout_index, COUNT(*)
FROM planned_workouts pw
JOIN weekly_plans wp ON wp.id = pw.weekly_plan_id
WHERE wp.plan_id = ?
GROUP BY workout_index
HAVING COUNT(*) > 1;

-- Check rest day pattern
SELECT 
  week_number,
  EXTRACT(DOW FROM scheduled_date) as day_of_week,
  workout_type
FROM planned_workouts pw
JOIN weekly_plans wp ON wp.id = pw.weekly_plan_id
WHERE wp.plan_id = ?
  AND workout_type = 'rest'
ORDER BY week_number;
```

**Acceptance Criteria**:
- ✅ All manual scenarios pass
- ✅ Token budgets respected
- ✅ No duplicate workout indices
- ✅ Pattern modifications work correctly
- ✅ Database integrity maintained
- ✅ No orphaned records

---

## Implementation Order

1. **Task 5.1** - Context Loader (foundation)
2. **Task 5.2** - Intent Parser (independent)
3. **Task 5.3** - Regeneration Prompts (depends on 5.1, 5.2)
4. **Task 5.4** - Regeneration API (depends on 5.1-5.3)
5. **Task 5.6** - Database Replace (independent, needed for API)
6. **Task 5.5** - Preview UI (independent)
7. **Task 5.7** - Chat Interface (depends on 5.4-5.6)
8. **Task 5.8** - Testing (validates everything)

---

## Files Created/Modified

**New Files**:
- `lib/chat/plan-context-loader.ts`
- `lib/chat/intent-parser.ts`
- `lib/chat/workout-reference-parser.ts`
- `lib/chat/regeneration-prompts.ts`
- `lib/chat/plan-replacer.ts`
- `app/api/chat/regenerate/route.ts`
- `app/api/chat/apply-changes/route.ts`
- `components/chat/plan-chat.tsx`
- `components/chat/plan-diff-preview.tsx`

**Modified Files**:
- `app/dashboard/plans/review/[planId]/page.tsx`

---

## Success Criteria

Phase 5 complete when:

- ✅ Full plan context loaded efficiently (<30K tokens)
- ✅ User intents parsed correctly
- ✅ Regeneration maintains all constraints
- ✅ Preview shows accurate before/after
- ✅ Changes applied atomically
- ✅ All use cases work:
  - Pattern reschedules (rest days, long runs)
  - Pattern replacements (intervals → tempo)
  - Week adjustments (recovery weeks)
  - Gap insertions (holidays)
  - Race insertions (tapers/recovery)
- ✅ No consecutive hard workouts after regeneration
- ✅ Rest day preferences respected
- ✅ Phase structures maintained
- ✅ Database integrity preserved
- ✅ UI refreshes correctly
- ✅ All tests pass

---

## Notes for Claude Code

**Critical Points**:

1. **Regeneration ≠ Field Updates**: You're calling the LLM to recreate weeks, not updating individual fields

2. **Full Context Required**: DeepSeek needs the entire plan to make intelligent modifications

3. **Constraint Enforcement**: The LLM prompt must include ALL original constraints

4. **Atomic Operations**: Delete + insert must succeed or fail together

5. **Preview Essential**: User MUST see changes before applying

6. **Token Management**: Monitor input/output sizes, especially for 18+ week plans

**Common Pitfalls**:

- Forgetting to include template in context
- Not checking consecutive hard workouts after regeneration  
- Partial database updates leaving orphaned records
- Not recalculating workout dates correctly
- Losing phase linkages during replace
