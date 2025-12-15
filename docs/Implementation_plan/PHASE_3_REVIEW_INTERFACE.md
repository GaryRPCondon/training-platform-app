# Phase 3: Review Interface - Implementation Tasks

## Overview
Build the review interface where athletes can see their generated plan on a calendar and refine it through conversational chat. This phase creates the visual review environment, basic chat infrastructure, and applies consistent color coding to both planned workouts and completed activities calendars.

**Duration**: 3-4 days  
**Prerequisites**: Phase 1 & Phase 2 complete, draft plan generated  
**Dependencies**: 
- react-big-calendar (already installed)
- Chat interface components
- Plan data from Phase 2
- Existing activities calendar (from Phase 1)

---

## Architecture Overview

### Page Layout (60/40 Split)

```
┌─────────────────────────────────────────────────────────┐
│ Header (Plan Name, Status Badge, Actions)              │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌────────────────────┐  ┌──────────────────────────┐  │
│  │                    │  │                          │  │
│  │    Calendar        │  │     Chat Panel           │  │
│  │    (60%)           │  │     (40%)                │  │
│  │                    │  │                          │  │
│  │  - Week view       │  │  - Message history       │  │
│  │  - Workout cards   │  │  - Input field           │  │
│  │  - Color coding    │  │  - Context awareness     │  │
│  │  - Click for info  │  │  - "Make W4:D2 easier"   │  │
│  │                    │  │                          │  │
│  └────────────────────┘  └──────────────────────────┘  │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

## Task 3.1: TypeScript Types for Review

**File:** `types/review.ts`

### Implementation

```typescript
import type { PlannedWorkout, WeeklyPlan, TrainingPhase } from './database'

// Calendar event for react-big-calendar
export interface WorkoutEvent {
  id: number
  title: string
  start: Date
  end: Date
  resource: PlannedWorkout
}

// Extended planned workout with computed fields
export interface WorkoutWithDetails extends PlannedWorkout {
  date: Date
  formatted_date: string
  phase_name: string
  week_of_plan: number
}

// Week view data structure
export interface WeekViewData {
  week_number: number
  week_start: Date
  week_end: Date
  phase: string
  workouts: WorkoutWithDetails[]
  weekly_volume: number
  weekly_plan_id: number
}

// Plan review context
export interface PlanReviewContext {
  plan_id: number
  plan_name: string
  goal_date: string
  goal_type: string
  template_name: string
  status: string
  total_weeks: number
  current_week: number
  phases: TrainingPhase[]
  weeks: WeekViewData[]
}

// Chat message for review session
export interface ReviewMessage {
  id: number
  role: 'user' | 'assistant' | 'system'
  content: string
  created_at: string
  metadata?: {
    referenced_workouts?: string[]  // e.g., ["W4:D2", "W5:D3"]
    action_taken?: string
  }
}
```

### Claude Code Prompt

```
Create types/review.ts with:
1. WorkoutEvent interface for calendar display
2. WorkoutWithDetails - extended workout with computed fields (date, phase_name, week_of_plan)
3. WeekViewData - represents one week with all workouts
4. PlanReviewContext - full plan context for review page
5. ReviewMessage - chat message with optional metadata for workout references

Export all interfaces.
```

---

## Task 3.2: Plan Data Loader

**File:** `lib/plans/review-loader.ts`

### Implementation

```typescript
import { supabase, getCurrentAthleteId } from '@/lib/supabase/client'
import type { PlanReviewContext, WeekViewData, WorkoutWithDetails } from '@/types/review'
import { parseISO, format, startOfWeek, endOfWeek } from 'date-fns'

export async function loadPlanForReview(planId: number): Promise<PlanReviewContext> {
  const athleteId = getCurrentAthleteId()

  // Load plan with all related data
  const { data: plan, error: planError } = await supabase
    .from('training_plans')
    .select(`
      id,
      name,
      goal_id,
      start_date,
      end_date,
      plan_type,
      status,
      template_id,
      template_version,
      created_at,
      athlete_goals (
        goal_name,
        goal_type,
        target_date
      ),
      training_phases (
        id,
        phase_name,
        phase_order,
        start_date,
        end_date
      )
    `)
    .eq('id', planId)
    .eq('athlete_id', athleteId)
    .single()

  if (planError) throw new Error(`Failed to load plan: ${planError.message}`)
  if (!plan) throw new Error('Plan not found')

  // Load all weekly plans with workouts
  const { data: weeklyPlans, error: weeksError } = await supabase
    .from('weekly_plans')
    .select(`
      id,
      week_start_date,
      week_number,
      weekly_volume_target,
      phase_id,
      planned_workouts (
        id,
        scheduled_date,
        scheduled_time,
        workout_type,
        description,
        distance_target_meters,
        duration_target_seconds,
        intensity_target,
        structured_workout,
        workout_index,
        status
      )
    `)
    .eq('athlete_id', athleteId)
    .in('phase_id', plan.training_phases.map(p => p.id))
    .order('week_start_date', { ascending: true })

  if (weeksError) throw new Error(`Failed to load weeks: ${weeksError.message}`)

  // Process weeks into structured format
  const weeks: WeekViewData[] = weeklyPlans.map(week => {
    const phase = plan.training_phases.find(p => p.id === week.phase_id)
    
    const workoutsWithDetails: WorkoutWithDetails[] = week.planned_workouts.map(workout => ({
      ...workout,
      date: parseISO(workout.scheduled_date),
      formatted_date: format(parseISO(workout.scheduled_date), 'EEE, MMM d'),
      phase_name: phase?.phase_name || 'unknown',
      week_of_plan: week.week_number
    }))

    return {
      week_number: week.week_number,
      week_start: parseISO(week.week_start_date),
      week_end: endOfWeek(parseISO(week.week_start_date)),
      phase: phase?.phase_name || 'unknown',
      workouts: workoutsWithDetails,
      weekly_volume: week.weekly_volume_target || 0,
      weekly_plan_id: week.id
    }
  })

  // Calculate total weeks
  const totalWeeks = weeks.length

  // Determine current week (for future: track progress)
  const currentWeek = 1  // For now, always start at week 1 during review

  return {
    plan_id: plan.id,
    plan_name: plan.athlete_goals?.goal_name || plan.name || 'Training Plan',
    goal_date: plan.athlete_goals?.target_date || plan.end_date,
    goal_type: plan.athlete_goals?.goal_type || plan.plan_type,
    template_name: plan.template_id || 'Custom',
    status: plan.status,
    total_weeks: totalWeeks,
    current_week: currentWeek,
    phases: plan.training_phases.sort((a, b) => a.phase_order - b.phase_order),
    weeks: weeks
  }
}

export function getWeekByNumber(context: PlanReviewContext, weekNumber: number): WeekViewData | undefined {
  return context.weeks.find(w => w.week_number === weekNumber)
}

export function getWorkoutByIndex(context: PlanReviewContext, workoutIndex: string): WorkoutWithDetails | undefined {
  for (const week of context.weeks) {
    const workout = week.workouts.find(w => w.workout_index === workoutIndex)
    if (workout) return workout
  }
  return undefined
}
```

### Claude Code Prompt

```
Create lib/plans/review-loader.ts with:

1. loadPlanForReview(planId) - Comprehensive data loader:
   - Query training_plans with joins to athlete_goals, training_phases
   - Query weekly_plans with planned_workouts
   - Match phases to weeks by phase_id
   - Process workouts: add date object, formatted_date, phase_name, week_of_plan
   - Build WeekViewData[] array sorted by week_start_date
   - Return PlanReviewContext with all data

2. getWeekByNumber(context, weekNumber) - Find week by number

3. getWorkoutByIndex(context, workoutIndex) - Find workout by W#:D# index
   - Loop through all weeks
   - Find workout where workout_index matches
   - Return WorkoutWithDetails or undefined

Export all functions.

Use date-fns for date parsing and formatting.
Handle errors with descriptive messages.
```

---

## Task 3.2.5: Shared Workout Colors

**File:** `lib/constants/workout-colors.ts`

### Implementation

```typescript
// Shared color scheme for workout types across all calendars
export const WORKOUT_COLORS: Record<string, string> = {
  'easy_run': '#10b981',      // Green
  'long_run': '#3b82f6',      // Blue
  'tempo': '#f59e0b',         // Amber
  'intervals': '#ef4444',     // Red
  'race_pace': '#8b5cf6',     // Purple
  'recovery': '#6ee7b7',      // Light green
  'rest': '#94a3b8',          // Gray
  'cross_training': '#06b6d4', // Cyan
  'strength': '#f472b6',      // Pink
  'default': '#6b7280'        // Gray (fallback)
}

export function getWorkoutColor(workoutType: string): string {
  return WORKOUT_COLORS[workoutType] || WORKOUT_COLORS.default
}
```

### Claude Code Prompt

```
Create lib/constants/workout-colors.ts with:

1. Export WORKOUT_COLORS object mapping workout types to hex colors:
   - easy_run: green (#10b981)
   - long_run: blue (#3b82f6)
   - tempo: amber (#f59e0b)
   - intervals: red (#ef4444)
   - race_pace: purple (#8b5cf6)
   - recovery: light green (#6ee7b7)
   - rest: gray (#94a3b8)
   - cross_training: cyan (#06b6d4)
   - strength: pink (#f472b6)
   - default: gray (#6b7280)

2. Export getWorkoutColor(workoutType) helper function:
   - Takes workout type string
   - Returns corresponding color hex code
   - Falls back to default if type not found

This file will be used by both the review calendar (planned workouts) and activities calendar (completed workouts) to ensure consistent color coding.
```

---

## Task 3.3: Calendar Component

**File:** `components/review/training-calendar.tsx`

### Implementation

```typescript
'use client'

import { useMemo, useState } from 'react'
import { Calendar, momentLocalizer, View } from 'react-big-calendar'
import moment from 'moment'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import type { WorkoutEvent, WorkoutWithDetails } from '@/types/review'
import { WorkoutCard } from './workout-card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { getWorkoutColor } from '@/lib/constants/workout-colors'

const localizer = momentLocalizer(moment)

interface TrainingCalendarProps {
  workouts: WorkoutWithDetails[]
  onWorkoutSelect?: (workout: WorkoutWithDetails) => void
}

export function TrainingCalendar({ workouts, onWorkoutSelect }: TrainingCalendarProps) {
  const [selectedWorkout, setSelectedWorkout] = useState<WorkoutWithDetails | null>(null)
  const [view, setView] = useState<View>('week')

  // Convert workouts to calendar events
  const events: WorkoutEvent[] = useMemo(() => {
    return workouts.map(workout => ({
      id: workout.id,
      title: formatWorkoutTitle(workout),
      start: workout.date,
      end: workout.date,
      resource: workout
    }))
  }, [workouts])

  const handleSelectEvent = (event: WorkoutEvent) => {
    setSelectedWorkout(event.resource)
    if (onWorkoutSelect) {
      onWorkoutSelect(event.resource)
    }
  }

  const eventStyleGetter = (event: WorkoutEvent) => {
    const workout = event.resource
    const backgroundColor = getWorkoutColor(workout.workout_type)
    
    return {
      style: {
        backgroundColor,
        borderRadius: '4px',
        opacity: 0.9,
        color: 'white',
        border: '0px',
        display: 'block',
        fontSize: '0.875rem',
        padding: '2px 4px'
      }
    }
  }

  return (
    <>
      <div className="h-full">
        <Calendar
          localizer={localizer}
          events={events}
          startAccessor="start"
          endAccessor="end"
          view={view}
          onView={setView}
          views={['week', 'month']}
          onSelectEvent={handleSelectEvent}
          eventPropGetter={eventStyleGetter}
          style={{ height: '100%' }}
          toolbar={true}
        />
      </div>

      {/* Workout Detail Modal */}
      <Dialog open={!!selectedWorkout} onOpenChange={() => setSelectedWorkout(null)}>
        <DialogContent className="max-w-2xl">
          {selectedWorkout && (
            <WorkoutCard 
              workout={selectedWorkout}
              onClose={() => setSelectedWorkout(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function formatWorkoutTitle(workout: WorkoutWithDetails): string {
  const type = workout.workout_type.replace('_', ' ').toUpperCase()
  
  if (workout.distance_target_meters) {
    const km = (workout.distance_target_meters / 1000).toFixed(1)
    return `${type} ${km}km`
  }
  
  if (workout.duration_target_seconds) {
    const mins = Math.round(workout.duration_target_seconds / 60)
    return `${type} ${mins}min`
  }
  
  return type
}
```

### Claude Code Prompt

```
Create components/review/training-calendar.tsx with:

1. TrainingCalendar component:
   - Props: workouts (WorkoutWithDetails[]), onWorkoutSelect callback
   - Use react-big-calendar with momentLocalizer
   - Convert workouts to WorkoutEvent[] with useMemo
   - Default to week view, support month view
   - Color code events by workout_type using getWorkoutColor()
   - Handle event selection → open WorkoutCard in Dialog
   - Format event titles: "EASY RUN 10.0km" or "TEMPO 45min"

2. Import getWorkoutColor from '@/lib/constants/workout-colors'

3. Event styling:
   - Use getWorkoutColor(workout.workout_type) for backgroundColor
   - Apply with eventPropGetter for colors

4. formatWorkoutTitle helper:
   - Show type + distance (if present)
   - Or type + duration (if present)
   - Or just type

Import Dialog from @/components/ui/dialog
Import WorkoutCard from './workout-card' (we'll create next)
```

---

## Task 3.4: Workout Card Component

**File:** `components/review/workout-card.tsx`

### Implementation

```typescript
'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import type { WorkoutWithDetails } from '@/types/review'
import { Calendar, Clock, TrendingUp, Target } from 'lucide-react'

interface WorkoutCardProps {
  workout: WorkoutWithDetails
  onClose?: () => void
  onDiscuss?: (workout: WorkoutWithDetails) => void
}

export function WorkoutCard({ workout, onClose, onDiscuss }: WorkoutCardProps) {
  const hasStructuredWorkout = workout.structured_workout && 
    typeof workout.structured_workout === 'object'

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xl font-semibold">
            {workout.workout_type.replace('_', ' ').toUpperCase()}
          </h3>
          <Badge variant="outline">{workout.workout_index}</Badge>
        </div>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-1">
            <Calendar className="h-4 w-4" />
            {workout.formatted_date}
          </div>
          <Badge variant="secondary">{workout.phase_name}</Badge>
        </div>
      </div>

      <Separator />

      {/* Description */}
      {workout.description && (
        <div>
          <p className="text-sm text-muted-foreground">{workout.description}</p>
        </div>
      )}

      {/* Targets */}
      <div className="grid grid-cols-2 gap-4">
        {workout.distance_target_meters && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Target className="h-4 w-4" />
              Distance Target
            </div>
            <div className="text-lg font-medium">
              {(workout.distance_target_meters / 1000).toFixed(1)} km
            </div>
          </div>
        )}

        {workout.duration_target_seconds && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              Duration Target
            </div>
            <div className="text-lg font-medium">
              {Math.round(workout.duration_target_seconds / 60)} minutes
            </div>
          </div>
        )}

        {workout.intensity_target && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <TrendingUp className="h-4 w-4" />
              Intensity
            </div>
            <Badge>{workout.intensity_target}</Badge>
          </div>
        )}
      </div>

      {/* Structured Workout Details */}
      {hasStructuredWorkout && (
        <>
          <Separator />
          <div>
            <h4 className="font-medium mb-2">Workout Structure</h4>
            <div className="text-sm space-y-1">
              {renderStructuredWorkout(workout.structured_workout as any)}
            </div>
          </div>
        </>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        {onDiscuss && (
          <Button 
            onClick={() => onDiscuss(workout)}
            variant="default"
            className="flex-1"
          >
            Discuss with Coach
          </Button>
        )}
        {onClose && (
          <Button onClick={onClose} variant="outline">
            Close
          </Button>
        )}
      </div>
    </div>
  )
}

function renderStructuredWorkout(structure: any): React.ReactNode {
  if (!structure) return null

  const parts: string[] = []

  if (structure.warmup) {
    parts.push(`Warmup: ${formatWorkoutPart(structure.warmup)}`)
  }

  if (structure.main_set) {
    if (Array.isArray(structure.main_set)) {
      structure.main_set.forEach((set: any, i: number) => {
        if (set.repeat && set.intervals) {
          const intervals = set.intervals.map((int: any) => formatInterval(int)).join(', ')
          parts.push(`Set ${i + 1}: ${set.repeat}x (${intervals})`)
        }
      })
    } else {
      parts.push(`Main: ${formatWorkoutPart(structure.main_set)}`)
    }
  }

  if (structure.cooldown) {
    parts.push(`Cooldown: ${formatWorkoutPart(structure.cooldown)}`)
  }

  return (
    <div className="space-y-1">
      {parts.map((part, i) => (
        <div key={i} className="text-muted-foreground">{part}</div>
      ))}
    </div>
  )
}

function formatWorkoutPart(part: any): string {
  const details: string[] = []
  
  if (part.duration_minutes) {
    details.push(`${part.duration_minutes}min`)
  }
  if (part.distance_meters) {
    details.push(`${(part.distance_meters / 1000).toFixed(1)}km`)
  }
  if (part.intensity) {
    details.push(part.intensity)
  }
  if (part.target_pace) {
    details.push(`@ ${part.target_pace}`)
  }
  
  return details.join(' ')
}

function formatInterval(interval: any): string {
  const parts: string[] = []
  
  if (interval.distance_meters) {
    parts.push(`${interval.distance_meters}m`)
  }
  if (interval.duration_seconds) {
    parts.push(`${interval.duration_seconds}s`)
  }
  if (interval.target_pace) {
    parts.push(`@ ${interval.target_pace}`)
  }
  if (interval.intensity) {
    parts.push(interval.intensity)
  }
  
  return parts.join(' ')
}
```

### Claude Code Prompt

```
Create components/review/workout-card.tsx with:

1. WorkoutCard component displaying:
   - Header: workout type + workout_index badge + formatted_date
   - Phase badge
   - Description (if present)
   - Target grid: distance, duration, intensity (show only if present)
   - Structured workout details (if present)
   - Action buttons: "Discuss with Coach" and "Close"

2. renderStructuredWorkout helper:
   - Parse warmup/main_set/cooldown
   - Format intervals nicely: "8x (400m @ 3:45/km, 90s recovery)"
   - Display as readable text lines

3. Use shadcn components: Badge, Button, Separator
4. Use lucide-react icons: Calendar, Clock, TrendingUp, Target

Props:
- workout: WorkoutWithDetails
- onClose?: callback
- onDiscuss?: callback (for Phase 4)
```

---

## Task 3.5: Chat Interface Component

**File:** `components/review/chat-panel.tsx`

### Implementation

```typescript
'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Loader2, Send } from 'lucide-react'
import type { ReviewMessage } from '@/types/review'

interface ChatPanelProps {
  planId: number
  sessionId: number
  messages: ReviewMessage[]
  onSendMessage: (message: string) => Promise<void>
  isLoading?: boolean
}

export function ChatPanel({ 
  planId, 
  sessionId, 
  messages, 
  onSendMessage,
  isLoading = false 
}: ChatPanelProps) {
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const scrollAreaRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight
    }
  }, [messages])

  const handleSend = async () => {
    if (!input.trim() || isSending) return

    setIsSending(true)
    try {
      await onSendMessage(input.trim())
      setInput('')
    } finally {
      setIsSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col h-full bg-background border-l">
      {/* Header */}
      <div className="p-4 border-b">
        <h2 className="font-semibold">Chat with Your Coach</h2>
        <p className="text-sm text-muted-foreground">
          Ask questions or request changes using workout codes (e.g., "Make W4:D2 easier")
        </p>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4" ref={scrollAreaRef}>
        <div className="space-y-4">
          {messages.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              <p>Start a conversation about your training plan.</p>
              <p className="text-sm mt-2">
                Try: "What's the purpose of W1:D3?" or "Make W5:D2 10km instead"
              </p>
            </div>
          ) : (
            messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))
          )}
          
          {isLoading && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Coach is thinking...</span>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="p-4 border-t">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your message... (Shift+Enter for new line)"
            className="min-h-[60px] max-h-[120px]"
            disabled={isSending}
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || isSending}
            size="icon"
            className="shrink-0"
          >
            {isSending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: ReviewMessage }) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'

  if (isSystem) {
    return (
      <div className="text-center text-sm text-muted-foreground py-2">
        {message.content}
      </div>
    )
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-2 ${
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted'
        }`}
      >
        <div className="text-sm whitespace-pre-wrap">{message.content}</div>
        {message.metadata?.referenced_workouts && (
          <div className="flex gap-1 mt-2 flex-wrap">
            {message.metadata.referenced_workouts.map(ref => (
              <span
                key={ref}
                className="text-xs px-2 py-0.5 rounded bg-background/20"
              >
                {ref}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
```

### Claude Code Prompt

```
Create components/review/chat-panel.tsx with:

1. ChatPanel component:
   - Props: planId, sessionId, messages, onSendMessage callback, isLoading
   - Header with title and helper text about W#:D# format
   - ScrollArea for messages with auto-scroll to bottom
   - Empty state with example prompts
   - Loading indicator when isLoading
   - Textarea input with Shift+Enter for new line, Enter to send
   - Send button with loading state
   - Disable input while sending

2. MessageBubble sub-component:
   - User messages: right-aligned, primary color
   - Assistant messages: left-aligned, muted background
   - System messages: centered, muted text
   - Show referenced_workouts tags if present in metadata

Use shadcn components: Button, Textarea, ScrollArea
Use lucide-react icons: Loader2, Send
```

---

## Task 3.6.5: Update Activities Calendar with Colors

**File:** `app/dashboard/calendar/page.tsx`

### Overview

Apply the same color scheme to the existing activities calendar (completed workouts from Garmin/Strava sync). This ensures visual consistency across the platform - planned workouts and completed activities use identical colors.

### Implementation Strategy

**Note to Claude Code:** This task updates an **existing file** from Phase 1. Inspect the current implementation first to understand:
- How events are currently structured
- What properties are available on activity objects
- Whether the calendar already uses eventPropGetter (if so, update it)

### Code Changes

**1. Add import:**
```typescript
import { getWorkoutColor } from '@/lib/constants/workout-colors'
```

**2. Add eventStyleGetter function:**
```typescript
const eventStyleGetter = (event: any) => {
  // Activities might use 'activity_type' or 'type' - check your data structure
  const activityType = event.resource?.activity_type || event.resource?.type || 'default'
  const backgroundColor = getWorkoutColor(activityType)
  
  return {
    style: {
      backgroundColor,
      borderRadius: '4px',
      opacity: 0.9,
      color: 'white',
      border: '0px',
      display: 'block',
      fontSize: '0.875rem',
      padding: '2px 4px'
    }
  }
}
```

**3. Pass to Calendar component:**
```typescript
<Calendar
  localizer={localizer}
  events={events}
  eventPropGetter={eventStyleGetter}  // Add this line
  // ... other existing props
/>
```

### Claude Code Prompt

```
Update app/dashboard/calendar/page.tsx to add color coding to completed activities:

1. Import getWorkoutColor from '@/lib/constants/workout-colors'

2. Add eventStyleGetter function:
   - Extract activity_type from event.resource (inspect data structure to find correct property name)
   - Get color using getWorkoutColor(activity_type)
   - Return style object with backgroundColor, borderRadius, opacity, color, border, display, fontSize, padding
   - Match the style format used in the review calendar

3. Pass eventPropGetter={eventStyleGetter} to the Calendar component

4. Test that:
   - Activities appear with colors matching their type
   - Easy runs are green, tempo runs are amber, etc.
   - Colors match the review calendar scheme

IMPORTANT: 
- Inspect the existing file structure first
- The calendar and event structure may differ from the review calendar
- Activity objects may have different property names than planned workouts
- Don't break existing functionality (detail modals, event clicks, etc.)
```

### Verification

After implementation:
- [ ] Activities calendar shows colors
- [ ] Colors match workout types (green for easy, blue for long, etc.)
- [ ] Same color scheme as review calendar
- [ ] Clicking activities still opens detail view (existing functionality preserved)
- [ ] Colors visible in both week and month views

---

## Task 3.6: Review Page

**File:** `app/dashboard/plans/review/[planId]/page.tsx`

### Implementation

```typescript
'use client'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { TrainingCalendar } from '@/components/review/training-calendar'
import { ChatPanel } from '@/components/review/chat-panel'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, CheckCircle2, ArrowLeft } from 'lucide-react'
import { loadPlanForReview } from '@/lib/plans/review-loader'
import type { PlanReviewContext, ReviewMessage, WorkoutWithDetails } from '@/types/review'
import { supabase, getCurrentAthleteId } from '@/lib/supabase/client'

interface PageProps {
  params: Promise<{ planId: string }>
}

export default function ReviewPage({ params }: PageProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { planId: planIdString } = use(params)
  const planId = parseInt(planIdString, 10)
  const athleteId = getCurrentAthleteId()

  const [sessionId, setSessionId] = useState<number | null>(null)

  // Load plan data
  const { data: context, isLoading: isLoadingPlan } = useQuery({
    queryKey: ['plan-review', planId],
    queryFn: () => loadPlanForReview(planId)
  })

  // Create or load chat session
  useEffect(() => {
    async function initSession() {
      // Check for existing session
      const { data: existingSessions } = await supabase
        .from('chat_sessions')
        .select('id')
        .eq('athlete_id', athleteId)
        .eq('session_type', 'plan_review')
        .eq('plan_id', planId)
        .is('ended_at', null)
        .order('started_at', { ascending: false })
        .limit(1)

      if (existingSessions && existingSessions.length > 0) {
        setSessionId(existingSessions[0].id)
      } else {
        // Create new session
        const { data: newSession, error } = await supabase
          .from('chat_sessions')
          .insert({
            athlete_id: athleteId,
            session_type: 'plan_review',
            plan_id: planId,
            context: { plan_id: planId }
          })
          .select()
          .single()

        if (!error && newSession) {
          setSessionId(newSession.id)
        }
      }
    }

    if (planId) {
      initSession()
    }
  }, [planId, athleteId])

  // Load chat messages
  const { data: messages = [], isLoading: isLoadingMessages } = useQuery({
    queryKey: ['chat-messages', sessionId],
    queryFn: async () => {
      if (!sessionId) return []
      
      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true })

      if (error) throw error
      return data as ReviewMessage[]
    },
    enabled: !!sessionId
  })

  // Send message mutation
  const sendMessage = useMutation({
    mutationFn: async (message: string) => {
      if (!sessionId || !context) throw new Error('Session not ready')

      // Save user message
      await supabase
        .from('chat_messages')
        .insert({
          session_id: sessionId,
          role: 'user',
          content: message
        })

      // Call refine API (Phase 4 will implement this)
      const response = await fetch('/api/plans/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan_id: planId,
          session_id: sessionId,
          message,
          context
        })
      })

      if (!response.ok) {
        throw new Error('Failed to get response')
      }

      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chat-messages', sessionId] })
      queryClient.invalidateQueries({ queryKey: ['plan-review', planId] })
    }
  })

  // Accept plan mutation
  const acceptPlan = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('training_plans')
        .update({ status: 'active' })
        .eq('id', planId)
        .eq('athlete_id', athleteId)

      if (error) throw error
    },
    onSuccess: () => {
      router.push('/dashboard/plans')
    }
  })

  if (isLoadingPlan || !context) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  // Flatten all workouts for calendar
  const allWorkouts: WorkoutWithDetails[] = context.weeks.flatMap(w => w.workouts)

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <div className="border-b bg-background px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.push('/dashboard/plans')}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">{context.plan_name}</h1>
              <p className="text-sm text-muted-foreground">
                {context.total_weeks} weeks • {context.goal_type.replace('_', ' ')} • Goal: {context.goal_date}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={context.status === 'active' ? 'default' : 'secondary'}>
              {context.status}
            </Badge>
            <Button
              onClick={() => acceptPlan.mutate()}
              disabled={context.status === 'active' || acceptPlan.isPending}
              size="lg"
            >
              {acceptPlan.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Accepting...
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Accept Plan
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content: 60/40 Split */}
      <div className="flex-1 flex overflow-hidden">
        {/* Calendar - 60% */}
        <div className="w-[60%] p-6 overflow-auto">
          <TrainingCalendar
            workouts={allWorkouts}
            onWorkoutSelect={(workout) => {
              console.log('Selected workout:', workout.workout_index)
              // Could auto-insert workout_index into chat input
            }}
          />
        </div>

        {/* Chat Panel - 40% */}
        <div className="w-[40%]">
          {sessionId ? (
            <ChatPanel
              planId={planId}
              sessionId={sessionId}
              messages={messages}
              onSendMessage={(msg) => sendMessage.mutateAsync(msg)}
              isLoading={sendMessage.isPending}
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
```

### Claude Code Prompt

```
Create app/dashboard/plans/review/[planId]/page.tsx with:

1. Page component accepting params with planId
   - Use async params: const { planId } = use(params)
   - Parse planId to integer

2. Load plan data with useQuery:
   - Call loadPlanForReview(planId)
   - Cache with key ['plan-review', planId]

3. Initialize chat session (useEffect):
   - Query for existing session (session_type='plan_review', plan_id=planId, ended_at is null)
   - If found: use existing session_id
   - If not: create new chat_sessions record with plan_id and session_type='plan_review'
   - Store sessionId in state

4. Load messages with useQuery:
   - Query chat_messages where session_id matches
   - Order by created_at ascending
   - Enabled only when sessionId exists

5. sendMessage mutation:
   - Save user message to chat_messages
   - Call /api/plans/refine (Phase 4 will implement)
   - Invalidate queries on success

6. acceptPlan mutation:
   - Update training_plans.status = 'active'
   - Navigate to /dashboard/plans on success

7. Layout:
   - Header: Back button, plan name, metadata, status badge, Accept button
   - 60% calendar (left) + 40% chat (right)
   - Full height layout with overflow handling

8. Flatten context.weeks into allWorkouts array for calendar

Use 'use client' directive.
Import all required components.
Handle loading states.
```

---

## Testing Checklist

### Test 3.1: Plan Data Loading
- [ ] Navigate to /dashboard/plans/review/[planId] with valid plan ID
- [ ] Verify plan name, goal date, status display in header
- [ ] Check total_weeks and phases load correctly
- [ ] Confirm all workouts present across all weeks

### Test 3.2: Review Calendar Display
- [ ] Calendar shows all workouts with correct dates
- [ ] Workout colors match types (easy=green, tempo=amber, etc.)
- [ ] Event titles show distance or duration
- [ ] Week view displays properly
- [ ] Can switch to month view
- [ ] Clicking workout opens detail modal

### Test 3.2.1: Activities Calendar Color Coding
- [ ] Navigate to /dashboard/calendar
- [ ] Completed activities show with color coding
- [ ] Colors match workout types (same scheme as review calendar)
- [ ] Easy runs are green, long runs are blue, tempo runs are amber, etc.
- [ ] Clicking activity opens detail modal (existing functionality preserved)
- [ ] Colors visible in both week and month view

### Test 3.3: Workout Detail Modal
- [ ] Modal displays workout_index badge
- [ ] Shows formatted date and phase
- [ ] Displays description if present
- [ ] Target metrics (distance/duration/intensity) visible
- [ ] Structured workout details render (if present)
- [ ] "Discuss with Coach" button present
- [ ] Close button works

### Test 3.4: Chat Interface
- [ ] Chat panel loads on right side (40% width)
- [ ] Empty state shows helper text
- [ ] Can type message in textarea
- [ ] Shift+Enter creates new line
- [ ] Enter sends message
- [ ] Send button disabled when empty
- [ ] User messages right-aligned (blue)
- [ ] Messages auto-scroll to bottom

### Test 3.5: Chat Session
- [ ] Session created on first page load
- [ ] Session persists on page refresh
- [ ] Multiple tabs use same session
- [ ] Messages persist across page reloads
- [ ] Session links to correct plan_id

### Test 3.6: Accept Plan
- [ ] Accept button visible when status='draft_generated'
- [ ] Click Accept → status changes to 'active'
- [ ] Redirects to /dashboard/plans after accept
- [ ] Badge updates to show 'active'
- [ ] Accept button disabled if already active

### Test 3.7: Mobile Responsiveness
- [ ] Test on tablet (should stack 60/40 → 100/100)
- [ ] Chat panel scrolls properly
- [ ] Calendar events readable
- [ ] Buttons accessible
- [ ] Modal fits screen

### Test 3.8: Error Handling
- [ ] Invalid plan ID → error message
- [ ] Plan not found → redirect or error
- [ ] Session creation failure → retry or error
- [ ] Message send failure → show error toast
- [ ] Accept plan failure → show error

---

## Troubleshooting

### Issue: Calendar events not showing
**Check:**
- Verify workouts have valid `scheduled_date`
- Confirm dates parsed correctly with parseISO
- Check console for date parsing errors
- Verify allWorkouts array populated

**Fix:**
```typescript
console.log('All workouts:', allWorkouts.length)
console.log('First workout date:', allWorkouts[0]?.date)
```

### Issue: Chat session not creating
**Check:**
- Supabase chat_sessions table permissions
- athleteId is correct
- plan_id exists in training_plans

**Fix:**
```typescript
console.log('Creating session for:', { athleteId, planId })
// Check error object from insert
```

### Issue: Messages not loading
**Check:**
- sessionId set correctly
- chat_messages query enabled
- Messages ordered ascending

**Fix:**
```typescript
console.log('Session ID:', sessionId)
console.log('Messages count:', messages.length)
```

### Issue: 60/40 split not working
**Check:**
- Parent has `flex` class
- Both children have width classes
- No conflicting CSS

**Fix:**
```typescript
// Ensure parent: className="flex"
// Left: className="w-[60%]"
// Right: className="w-[40%]"
```

---

## Deliverables

- [ ] `lib/constants/workout-colors.ts` - Shared color scheme for all calendars
- [ ] `types/review.ts` - All TypeScript interfaces
- [ ] `lib/plans/review-loader.ts` - Plan data loading functions
- [ ] `components/review/training-calendar.tsx` - Review calendar component (with colors)
- [ ] `components/review/workout-card.tsx` - Workout detail card
- [ ] `components/review/chat-panel.tsx` - Chat interface
- [ ] `app/dashboard/plans/review/[planId]/page.tsx` - Review page
- [ ] `app/dashboard/calendar/page.tsx` - Activities calendar updated with colors
- [ ] All tests passing
- [ ] Can view generated plan on calendar (with color coding)
- [ ] Can see workout details
- [ ] Can chat (messages save, Phase 4 will add LLM responses)
- [ ] Can accept plan
- [ ] Activities calendar shows color-coded completed workouts

---

## Notes for Phase 4

**What's NOT in Phase 3:**
- LLM responses to chat messages (Phase 4)
- Workout modification logic (Phase 4)
- W#:D# parsing and context injection (Phase 4)
- Plan regeneration after changes (Phase 4)

**What IS in Phase 3:**
- Full visual review interface
- Chat message persistence
- Session management
- Calendar with workout display and color coding
- Activities calendar with color coding (consistency)
- Accept plan workflow

Phase 3 creates the UI shell with consistent visual design. Phase 4 adds the intelligence.

---

## Key Implementation Notes from Phase 2

### 1. Async Params (Next.js 15)
Always await params:
```typescript
const { planId } = use(params)  // Or await params in async components
```

### 2. Server-Side File Loading
Use fs.readFile in API routes:
```typescript
import { readFileSync } from 'fs'
import { join } from 'path'

const filePath = join(process.cwd(), 'public', 'templates', filename)
const content = readFileSync(filePath, 'utf-8')
```

### 3. Database Column Names
Use snake_case to match Supabase:
```typescript
workout_index  // not workoutIndex
scheduled_date // not scheduledDate
```

### 4. Date Handling
Always use date-fns for consistency:
```typescript
import { parseISO, format, startOfWeek } from 'date-fns'
const date = parseISO(workout.scheduled_date)
```

### 5. Query Invalidation
Invalidate related queries after mutations:
```typescript
queryClient.invalidateQueries({ queryKey: ['plan-review', planId] })
queryClient.invalidateQueries({ queryKey: ['chat-messages', sessionId] })
```
