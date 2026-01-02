# Phase 6: Workout Linking & Completion Tracking

## Overview

Display synced activities on the calendar and link them to planned workouts with completion tracking. Activity sync and merging are already implemented - this phase focuses on visualization, matching logic, and calendar integration.

**Duration**: 4-6 days  
**Prerequisites**: Phases 1-5 complete, activity sync working  
**Already Implemented**: 
- Garmin sync (MCP)
- Strava sync (direct API) 
- Activity merging (duplicate detection)

---

## Goals

### Primary Goals
1. ✅ Match synced activities to planned workouts automatically
2. ✅ Track workout completion status (completed/partial/skipped)
3. ✅ Display completion status on calendar
4. ✅ Manual activity-to-workout linking UI
5. ✅ Activity detail view with metrics

### Non-Goals (Already Done)
- ❌ Activity sync from platforms (done in Phase 1)
- ❌ Duplicate merging (done in Phase 1)
- ❌ Sync configuration UI (done in Phase 1)

### Non-Goals (Future Phases)
- ❌ Automated flag detection (Phase 7)
- ❌ Activity feedback collection (Phase 7)
- ❌ Manual activity entry (Phase 8+)

---

## Database Schema Updates

### Activity Matching Columns
```sql
-- migrations/006_activity_matching.sql

ALTER TABLE activities 
ADD COLUMN IF NOT EXISTS matched_workout_id INTEGER REFERENCES planned_workouts(id),
ADD COLUMN IF NOT EXISTS match_confidence FLOAT,  -- 0.0 to 1.0
ADD COLUMN IF NOT EXISTS match_method TEXT,  -- 'auto_time', 'auto_distance', 'manual'
ADD COLUMN IF NOT EXISTS match_metadata JSONB;

CREATE INDEX IF NOT EXISTS idx_activities_matched_workout 
ON activities(matched_workout_id) WHERE matched_workout_id IS NOT NULL;
```

### Workout Completion Tracking
```sql
ALTER TABLE planned_workouts
ADD COLUMN IF NOT EXISTS completion_status TEXT DEFAULT 'pending',  -- 'pending', 'completed', 'partial', 'skipped'
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS completion_metadata JSONB;

CREATE INDEX IF NOT EXISTS idx_planned_workouts_completion 
ON planned_workouts(athlete_id, completion_status, scheduled_date);

ALTER TABLE planned_workouts DROP CONSTRAINT IF EXISTS check_completion_status;
ALTER TABLE planned_workouts ADD CONSTRAINT check_completion_status 
CHECK (completion_status IN ('pending', 'completed', 'partial', 'skipped'));
```

### TypeScript Types
```typescript
// types/database.ts - UPDATE existing interfaces

export interface Activity {
  // ... existing fields ...
  
  // NEW: Matching fields
  matched_workout_id: number | null
  match_confidence: number | null
  match_method: 'auto_time' | 'auto_distance' | 'manual' | null
  match_metadata: {
    time_diff_minutes?: number
    distance_diff_percent?: number
    duration_diff_percent?: number
    manual_link_reason?: string
  } | null
}

export interface PlannedWorkout {
  // ... existing fields ...
  
  // NEW: Completion fields
  completion_status: 'pending' | 'completed' | 'partial' | 'skipped'
  completed_at: string | null
  completion_metadata: {
    actual_distance_meters?: number
    actual_duration_seconds?: number
    distance_variance_percent?: number
    duration_variance_percent?: number
    notes?: string
  } | null
}
```

---

## Implementation Tasks

### Task 6.0: Display Activities on Calendar

**Objective**: Show synced activities underneath planned workouts on the calendar.

**Design Pattern**:
```
┌─────────────────┐
│ Planned Workout │ ← Existing colored cards (green/pink/blue/orange/gray)
├─────────────────┤
│ Actual Activity │ ← NEW: Gray card underneath (if activity exists that day)
└─────────────────┘
```

**Visual Hierarchy**:
- **Planned workouts**: Keep existing colors (green = easy, pink = speed, blue = long run, orange = tempo, gray = rest)
- **Activities**: Light gray background, smaller text, positioned below planned workout
- **Spacing**: Small gap between planned and actual

**Files**:
- `lib/activities/activity-queries.ts` (new) - Query functions for activities
- `app/dashboard/calendar/page.tsx` (update) - Load activities alongside workouts
- `components/calendar/activity-card.tsx` (new) - Activity display card
- `components/calendar/calendar-day-cell.tsx` (update) - Render both workouts and activities

**Implementation**:

**File**: `lib/activities/activity-queries.ts`
```typescript
import { supabase, getCurrentAthleteId } from '@/lib/supabase/client'
import type { Activity } from '@/types/database'

/**
 * Get activities for a date range
 */
export async function getActivitiesForDateRange(
  startDate: string,
  endDate: string
): Promise<Activity[]> {
  const athleteId = getCurrentAthleteId()

  const { data, error } = await supabase
    .from('activities')
    .select('*')
    .eq('athlete_id', athleteId)
    .gte('start_time', startDate)
    .lte('start_time', endDate)
    .order('start_time', { ascending: true })

  if (error) throw error
  return data || []
}

/**
 * Group activities by date
 */
export function groupActivitiesByDate(activities: Activity[]): Map<string, Activity[]> {
  const grouped = new Map<string, Activity[]>()

  for (const activity of activities) {
    if (!activity.start_time) continue

    // Get date in YYYY-MM-DD format
    const date = activity.start_time.split('T')[0]

    if (!grouped.has(date)) {
      grouped.set(date, [])
    }
    grouped.get(date)!.push(activity)
  }

  return grouped
}
```

**File**: `components/calendar/activity-card.tsx`
```typescript
'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Activity } from 'lucide-react'
import type { Activity as ActivityType } from '@/types/database'

interface ActivityCardProps {
  activity: ActivityType
  onClick?: () => void
}

export function ActivityCard({ activity, onClick }: ActivityCardProps) {
  return (
    <Card
      className="border-l-4 border-l-gray-400 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors"
      onClick={onClick}
    >
      <CardContent className="p-2">
        <div className="flex items-center gap-2">
          <Activity className="h-3 w-3 text-gray-500 flex-shrink-0" />
          
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-gray-700 truncate">
              {activity.activity_name || activity.activity_type || 'Activity'}
            </div>
            
            <div className="flex items-center gap-2 text-xs text-gray-500">
              {activity.distance_meters && (
                <span>{(activity.distance_meters / 1000).toFixed(1)} km</span>
              )}
              {activity.duration_seconds && (
                <span>•</span>
              )}
              {activity.duration_seconds && (
                <span>{Math.floor(activity.duration_seconds / 60)} min</span>
              )}
            </div>
          </div>

          {/* Indicator if matched to workout */}
          {activity.matched_workout_id && (
            <div className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" title="Matched to planned workout" />
          )}
        </div>
      </CardContent>
    </Card>
  )
}
```

**File**: `app/dashboard/calendar/page.tsx` (UPDATE)
```typescript
'use client'

import { useQuery } from '@tanstack/react-query'
import { CalendarView } from '@/components/calendar/calendar-view'
import { getPlannedWorkoutsForDateRange } from '@/lib/plans/plan-queries'
import { getActivitiesForDateRange, groupActivitiesByDate } from '@/lib/activities/activity-queries'
import { startOfMonth, endOfMonth, format } from 'date-fns'
import { useState } from 'react'

export default function CalendarPage() {
  const [currentDate, setCurrentDate] = useState(new Date())

  // Calculate date range (current month ± 1 week for buffer)
  const startDate = format(
    new Date(startOfMonth(currentDate).getTime() - 7 * 24 * 60 * 60 * 1000),
    'yyyy-MM-dd'
  )
  const endDate = format(
    new Date(endOfMonth(currentDate).getTime() + 7 * 24 * 60 * 60 * 1000),
    'yyyy-MM-dd'
  )

  // Load planned workouts
  const { data: workouts, isLoading: workoutsLoading } = useQuery({
    queryKey: ['planned-workouts', startDate, endDate],
    queryFn: () => getPlannedWorkoutsForDateRange(startDate, endDate),
  })

  // Load activities
  const { data: activities, isLoading: activitiesLoading } = useQuery({
    queryKey: ['activities', startDate, endDate],
    queryFn: () => getActivitiesForDateRange(startDate, endDate),
  })

  // Group activities by date
  const activitiesByDate = activities ? groupActivitiesByDate(activities) : new Map()

  if (workoutsLoading || activitiesLoading) {
    return <div>Loading calendar...</div>
  }

  return (
    <CalendarView
      workouts={workouts || []}
      activitiesByDate={activitiesByDate}
      currentDate={currentDate}
      onDateChange={setCurrentDate}
    />
  )
}
```

**File**: `components/calendar/calendar-view.tsx` (UPDATE - add activities prop)
```typescript
'use client'

import { WorkoutCard } from './workout-card'
import { ActivityCard } from './activity-card'
import type { PlannedWorkout, Activity } from '@/types/database'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, parseISO } from 'date-fns'

interface CalendarViewProps {
  workouts: PlannedWorkout[]
  activitiesByDate: Map<string, Activity[]>
  currentDate: Date
  onDateChange: (date: Date) => void
}

export function CalendarView({ workouts, activitiesByDate, currentDate, onDateChange }: CalendarViewProps) {
  const monthStart = startOfMonth(currentDate)
  const monthEnd = endOfMonth(currentDate)
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd })

  return (
    <div className="grid grid-cols-7 gap-2">
      {/* Header row */}
      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
        <div key={day} className="font-semibold text-center p-2">
          {day}
        </div>
      ))}

      {/* Calendar days */}
      {daysInMonth.map(day => {
        const dateStr = format(day, 'yyyy-MM-dd')
        const dayWorkouts = workouts.filter(w => w.scheduled_date === dateStr)
        const dayActivities = activitiesByDate.get(dateStr) || []

        return (
          <div key={dateStr} className="border rounded-lg p-2 min-h-[120px] space-y-1">
            <div className="text-sm font-medium mb-1">{format(day, 'd')}</div>

            {/* Planned workouts */}
            {dayWorkouts.map(workout => (
              <WorkoutCard key={workout.id} workout={workout} />
            ))}

            {/* Activities (underneath workouts) */}
            {dayActivities.map(activity => (
              <ActivityCard 
                key={activity.id} 
                activity={activity}
                onClick={() => {
                  // Navigate to activity detail
                  window.location.href = `/dashboard/activities/${activity.id}`
                }}
              />
            ))}
          </div>
        )
      })}
    </div>
  )
}
```

**Acceptance Criteria**:
- ✅ Activities load for current month
- ✅ Activities display underneath planned workouts
- ✅ Gray styling distinguishes activities from workouts
- ✅ Shows distance and duration
- ✅ Green dot indicates if matched to workout
- ✅ Clickable to view activity detail
- ✅ Performance acceptable (loads quickly)

**Visual Result**:
```
┌─────────────────────┐
│ Easy aerobic run    │ ← Green card (planned)
│ 12.0km              │
├─────────────────────┤
│ 🏃 Morning Run  ●   │ ← Gray card (actual activity, matched)
│ 12.2km • 65 min     │
└─────────────────────┘
```

---

### Task 6.1: Database Schema Updates

**Files**:
- `migrations/006_activity_matching.sql` (new)
- `types/database.ts` (update)

**Steps**:
1. Create migration file with SQL above
2. Run in Supabase SQL Editor
3. Update TypeScript types
4. Verify `npm run build` succeeds

**Acceptance Criteria**:
- ✅ Migration runs without errors
- ✅ Columns exist in database
- ✅ TypeScript compiles

---

### Task 6.2: Workout Matching Service

**Objective**: Auto-match activities to planned workouts based on date/type/distance.

**Files**:
- `lib/activities/workout-matcher.ts` (new)

**Implementation**:

```typescript
import { supabase, getCurrentAthleteId } from '@/lib/supabase/client'
import { isSameDay, parseISO } from 'date-fns'
import type { Activity, PlannedWorkout } from '@/types/database'

export interface MatchResult {
  activityId: number
  workoutId: number
  confidence: number
  method: 'auto_time' | 'auto_distance'
  metadata: {
    time_diff_minutes?: number
    distance_diff_percent?: number
    duration_diff_percent?: number
  }
}

/**
 * Match activities to planned workouts for a date range
 */
export async function matchActivitiesToWorkouts(
  startDate: string,
  endDate: string
): Promise<MatchResult[]> {
  const athleteId = getCurrentAthleteId()

  // Get unmatched activities
  const { data: activities } = await supabase
    .from('activities')
    .select('*')
    .eq('athlete_id', athleteId)
    .is('matched_workout_id', null)
    .gte('start_time', startDate)
    .lte('start_time', endDate)
    .order('start_time', { ascending: true })

  // Get pending workouts
  const { data: workouts } = await supabase
    .from('planned_workouts')
    .select('*')
    .eq('athlete_id', athleteId)
    .eq('completion_status', 'pending')
    .gte('scheduled_date', startDate)
    .lte('scheduled_date', endDate)
    .order('scheduled_date', { ascending: true })

  if (!activities || !workouts) return []

  const matches: MatchResult[] = []

  for (const activity of activities) {
    const match = findBestWorkoutMatch(activity, workouts)

    if (match) {
      // Update activity
      await supabase
        .from('activities')
        .update({
          matched_workout_id: match.workoutId,
          match_confidence: match.confidence,
          match_method: match.method,
          match_metadata: match.metadata,
        })
        .eq('id', activity.id)

      // Update workout
      const variance = calculateWorkoutVariance(
        activity,
        workouts.find(w => w.id === match.workoutId)!
      )

      await supabase
        .from('planned_workouts')
        .update({
          completion_status: variance.status,
          completed_at: activity.start_time,
          completion_metadata: variance.metadata,
        })
        .eq('id', match.workoutId)

      matches.push(match)

      // Remove from pool
      workouts.splice(workouts.findIndex(w => w.id === match.workoutId), 1)
    }
  }

  return matches
}

/**
 * Find best matching workout for an activity
 */
function findBestWorkoutMatch(
  activity: Activity,
  workouts: PlannedWorkout[]
): MatchResult | null {
  if (!activity.start_time) return null

  const activityDate = parseISO(activity.start_time)

  // Same day workouts
  const sameDayWorkouts = workouts.filter(w =>
    isSameDay(parseISO(w.scheduled_date), activityDate)
  )

  if (sameDayWorkouts.length === 0) return null

  // Only one workout that day = high confidence match
  if (sameDayWorkouts.length === 1) {
    const workout = sameDayWorkouts[0]
    const confidence = calculateWorkoutConfidence(activity, workout)

    if (confidence > 0.6) {
      return {
        activityId: activity.id,
        workoutId: workout.id,
        confidence,
        method: 'auto_time',
        metadata: {
          distance_diff_percent: calculateDistanceDiff(activity, workout),
          duration_diff_percent: calculateDurationDiff(activity, workout),
        },
      }
    }
  }

  // Multiple workouts - match by type and distance
  let bestMatch: MatchResult | null = null

  for (const workout of sameDayWorkouts) {
    const confidence = calculateWorkoutConfidence(activity, workout)

    if (confidence > 0.7 && (!bestMatch || confidence > bestMatch.confidence)) {
      bestMatch = {
        activityId: activity.id,
        workoutId: workout.id,
        confidence,
        method: 'auto_distance',
        metadata: {
          distance_diff_percent: calculateDistanceDiff(activity, workout),
          duration_diff_percent: calculateDurationDiff(activity, workout),
        },
      }
    }
  }

  return bestMatch
}

/**
 * Calculate confidence score (0.0 to 1.0)
 */
function calculateWorkoutConfidence(
  activity: Activity,
  workout: PlannedWorkout
): number {
  let score = 0.5 // Base score for same day

  // Type match
  if (activity.activity_type?.toLowerCase() === workout.workout_type.toLowerCase()) {
    score += 0.2
  }

  // Distance similarity
  if (activity.distance_meters && workout.distance_target_meters) {
    const diff = Math.abs(activity.distance_meters - workout.distance_target_meters)
    const percent = diff / workout.distance_target_meters

    if (percent < 0.1) score += 0.2
    else if (percent < 0.2) score += 0.1
  }

  // Duration similarity
  if (activity.duration_seconds && workout.duration_target_seconds) {
    const diff = Math.abs(activity.duration_seconds - workout.duration_target_seconds)
    const percent = diff / workout.duration_target_seconds

    if (percent < 0.15) score += 0.1
  }

  return Math.min(1.0, score)
}

function calculateDistanceDiff(activity: Activity, workout: PlannedWorkout): number {
  if (!activity.distance_meters || !workout.distance_target_meters) return 0
  const diff = Math.abs(activity.distance_meters - workout.distance_target_meters)
  return (diff / workout.distance_target_meters) * 100
}

function calculateDurationDiff(activity: Activity, workout: PlannedWorkout): number {
  if (!activity.duration_seconds || !workout.duration_target_seconds) return 0
  const diff = Math.abs(activity.duration_seconds - workout.duration_target_seconds)
  return (diff / workout.duration_target_seconds) * 100
}

/**
 * Determine completion status based on variance
 */
function calculateWorkoutVariance(
  activity: Activity,
  workout: PlannedWorkout
): {
  status: 'completed' | 'partial' | 'skipped'
  metadata: any
} {
  const distanceDiff = calculateDistanceDiff(activity, workout)
  const durationDiff = calculateDurationDiff(activity, workout)

  // Completed: Within 20%
  if (distanceDiff < 20 && durationDiff < 20) {
    return {
      status: 'completed',
      metadata: {
        actual_distance_meters: activity.distance_meters,
        actual_duration_seconds: activity.duration_seconds,
        distance_variance_percent: distanceDiff,
        duration_variance_percent: durationDiff,
      },
    }
  }

  // Partial: 20-50% variance
  if (distanceDiff < 50 || durationDiff < 50) {
    return {
      status: 'partial',
      metadata: {
        actual_distance_meters: activity.distance_meters,
        actual_duration_seconds: activity.duration_seconds,
        distance_variance_percent: distanceDiff,
        duration_variance_percent: durationDiff,
        notes: 'Workout completed but different from plan',
      },
    }
  }

  // Skipped: Too different
  return {
    status: 'skipped',
    metadata: {
      notes: 'Activity too different from planned workout',
    },
  }
}

/**
 * Manually link an activity to a workout
 */
export async function manuallyLinkWorkout(
  activityId: number,
  workoutId: number,
  reason?: string
): Promise<void> {
  const athleteId = getCurrentAthleteId()

  const { data: activity } = await supabase
    .from('activities')
    .select('*')
    .eq('id', activityId)
    .eq('athlete_id', athleteId)
    .single()

  const { data: workout } = await supabase
    .from('planned_workouts')
    .select('*')
    .eq('id', workoutId)
    .eq('athlete_id', athleteId)
    .single()

  if (!activity || !workout) throw new Error('Not found')

  // Update activity
  await supabase
    .from('activities')
    .update({
      matched_workout_id: workoutId,
      match_confidence: 1.0,
      match_method: 'manual',
      match_metadata: { manual_link_reason: reason },
    })
    .eq('id', activityId)

  // Update workout
  const variance = calculateWorkoutVariance(activity, workout)
  await supabase
    .from('planned_workouts')
    .update({
      completion_status: variance.status,
      completed_at: activity.start_time,
      completion_metadata: {
        ...variance.metadata,
        manual_link: true,
        manual_link_reason: reason,
      },
    })
    .eq('id', workoutId)
}

/**
 * Unlink an activity from a workout
 */
export async function unlinkWorkout(activityId: number): Promise<void> {
  const athleteId = getCurrentAthleteId()

  const { data: activity } = await supabase
    .from('activities')
    .select('matched_workout_id')
    .eq('id', activityId)
    .eq('athlete_id', athleteId)
    .single()

  if (!activity?.matched_workout_id) return

  // Reset workout
  await supabase
    .from('planned_workouts')
    .update({
      completion_status: 'pending',
      completed_at: null,
      completion_metadata: null,
    })
    .eq('id', activity.matched_workout_id)

  // Unlink activity
  await supabase
    .from('activities')
    .update({
      matched_workout_id: null,
      match_confidence: null,
      match_method: null,
      match_metadata: null,
    })
    .eq('id', activityId)
}
```

**Acceptance Criteria**:
- ✅ Auto-matches activities to workouts on same day
- ✅ Confidence scoring works (type + distance + duration)
- ✅ Completion status calculated (completed/partial/skipped)
- ✅ Manual linking/unlinking supported

---

### Task 6.3: Matching API Route

**Objective**: Endpoint to trigger matching for date range.

**Files**:
- `app/api/activities/match/route.ts` (new)

**Implementation**:

```typescript
import { NextResponse } from 'next/server'
import { matchActivitiesToWorkouts } from '@/lib/activities/workout-matcher'

export async function POST(request: Request) {
  try {
    const { startDate, endDate } = await request.json()

    const matches = await matchActivitiesToWorkouts(startDate, endDate)

    return NextResponse.json({
      success: true,
      matches: matches.length,
      results: matches,
    })
  } catch (error) {
    console.error('Matching error:', error)
    return NextResponse.json(
      { 
        error: 'Matching failed', 
        message: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}
```

**Acceptance Criteria**:
- ✅ POST /api/activities/match triggers matching
- ✅ Returns match count and results
- ✅ Error handling

---

### Task 6.4: Link/Unlink API Routes

**Objective**: Endpoints for manual linking.

**Files**:
- `app/api/activities/link/route.ts` (new)

**Implementation**:

```typescript
import { NextResponse } from 'next/server'
import { manuallyLinkWorkout, unlinkWorkout } from '@/lib/activities/workout-matcher'

export async function POST(request: Request) {
  try {
    const { activityId, workoutId, reason } = await request.json()

    await manuallyLinkWorkout(activityId, workoutId, reason)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Link error:', error)
    return NextResponse.json(
      { error: 'Link failed' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const { activityId } = await request.json()

    await unlinkWorkout(activityId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Unlink error:', error)
    return NextResponse.json(
      { error: 'Unlink failed' },
      { status: 500 }
    )
  }
}
```

**Acceptance Criteria**:
- ✅ POST /api/activities/link manually links
- ✅ DELETE /api/activities/link unlinks
- ✅ Error handling

---

### Task 6.5: Calendar UI Updates

**Objective**: Show completion status on workout cards.

**Files**:
- `components/calendar/workout-card.tsx` (update)

**Implementation**:

```typescript
'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CheckCircle, Circle, XCircle, AlertCircle } from 'lucide-react'
import type { PlannedWorkout } from '@/types/database'

interface WorkoutCardProps {
  workout: PlannedWorkout
  onClick?: () => void
}

export function WorkoutCard({ workout, onClick }: WorkoutCardProps) {
  const statusConfig = {
    completed: {
      icon: <CheckCircle className="h-4 w-4 text-green-500" />,
      border: 'border-l-green-500',
      badge: 'text-green-600',
      text: '✓ Completed'
    },
    partial: {
      icon: <AlertCircle className="h-4 w-4 text-yellow-500" />,
      border: 'border-l-yellow-500',
      badge: 'text-yellow-600',
      text: '⚠ Partial'
    },
    skipped: {
      icon: <XCircle className="h-4 w-4 text-red-500" />,
      border: 'border-l-red-500',
      badge: 'text-red-600',
      text: '✗ Skipped'
    },
    pending: {
      icon: <Circle className="h-4 w-4 text-gray-400" />,
      border: 'border-l-gray-300',
      badge: '',
      text: ''
    },
  }

  const status = statusConfig[workout.completion_status]

  return (
    <Card
      className={`border-l-4 ${status.border} cursor-pointer hover:shadow-md transition-shadow`}
      onClick={onClick}
    >
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              {status.icon}
              <span className="font-medium text-sm">
                {workout.description || workout.workout_type}
              </span>
            </div>

            {workout.distance_target_meters && (
              <div className="text-xs text-muted-foreground">
                {(workout.distance_target_meters / 1000).toFixed(1)} km
              </div>
            )}

            {workout.completion_status !== 'pending' && (
              <div className={`text-xs mt-1 ${status.badge}`}>
                {status.text}
                {workout.completion_metadata?.distance_variance_percent &&
                 Math.abs(workout.completion_metadata.distance_variance_percent) > 10 && (
                  <span className="ml-1">
                    ({workout.completion_metadata.distance_variance_percent > 0 ? '+' : ''}
                    {workout.completion_metadata.distance_variance_percent.toFixed(0)}%)
                  </span>
                )}
              </div>
            )}
          </div>

          <Badge 
            variant={workout.intensity_target === 'easy' ? 'secondary' : 'default'} 
            className="text-xs"
          >
            {workout.intensity_target}
          </Badge>
        </div>
      </CardContent>
    </Card>
  )
}
```

**Acceptance Criteria**:
- ✅ Icons show completion status
- ✅ Color-coded borders (green/yellow/red/gray)
- ✅ Variance displayed if >10%
- ✅ Visual feedback on hover

---

### Task 6.6: Activity Detail Page

**Objective**: View activity metrics and manage workout linking.

**Files**:
- `app/dashboard/activities/[id]/page.tsx` (new)
- `components/activities/activity-detail.tsx` (new)
- `components/activities/workout-linker.tsx` (new)

**Implementation**:

**File**: `app/dashboard/activities/[id]/page.tsx`
```typescript
import { ActivityDetail } from '@/components/activities/activity-detail'
import { notFound } from 'next/navigation'
import { supabase, getCurrentAthleteId } from '@/lib/supabase/client'

export default async function ActivityDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const athleteId = getCurrentAthleteId()

  const { data: activity, error } = await supabase
    .from('activities')
    .select(`
      *,
      planned_workouts (*)
    `)
    .eq('id', params.id)
    .eq('athlete_id', athleteId)
    .single()

  if (error || !activity) {
    notFound()
  }

  return <ActivityDetail activity={activity} />
}
```

**File**: `components/activities/activity-detail.tsx`
```typescript
'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { WorkoutLinker } from './workout-linker'
import { format, parseISO } from 'date-fns'
import type { Activity } from '@/types/database'

interface ActivityDetailProps {
  activity: Activity & { planned_workouts?: any }
}

export function ActivityDetail({ activity }: ActivityDetailProps) {
  return (
    <div className="container max-w-4xl mx-auto p-6 space-y-6">
      {/* Activity Metrics */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle>{activity.activity_name || 'Activity'}</CardTitle>
              <div className="text-sm text-muted-foreground mt-1">
                {activity.start_time && format(parseISO(activity.start_time), 'PPp')}
              </div>
            </div>
            <Badge>{activity.activity_type}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {activity.distance_meters && (
              <div>
                <div className="text-sm text-muted-foreground">Distance</div>
                <div className="text-2xl font-bold">
                  {(activity.distance_meters / 1000).toFixed(2)} km
                </div>
              </div>
            )}

            {activity.duration_seconds && (
              <div>
                <div className="text-sm text-muted-foreground">Duration</div>
                <div className="text-2xl font-bold">
                  {Math.floor(activity.duration_seconds / 60)} min
                </div>
              </div>
            )}

            {activity.avg_hr && (
              <div>
                <div className="text-sm text-muted-foreground">Avg HR</div>
                <div className="text-2xl font-bold">{activity.avg_hr} bpm</div>
              </div>
            )}

            {activity.elevation_gain_meters && (
              <div>
                <div className="text-sm text-muted-foreground">Elevation</div>
                <div className="text-2xl font-bold">
                  {Math.round(activity.elevation_gain_meters)} m
                </div>
              </div>
            )}
          </div>

          {/* Pace */}
          {activity.distance_meters && activity.duration_seconds && (
            <div className="mt-4">
              <div className="text-sm text-muted-foreground">Average Pace</div>
              <div className="text-lg">
                {calculatePace(activity.distance_meters, activity.duration_seconds)}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Workout Linking */}
      <WorkoutLinker
        activity={activity}
        currentWorkout={activity.planned_workouts}
      />
    </div>
  )
}

function calculatePace(distanceMeters: number, durationSeconds: number): string {
  const paceSecondsPerKm = (durationSeconds / distanceMeters) * 1000
  const minutes = Math.floor(paceSecondsPerKm / 60)
  const seconds = Math.round(paceSecondsPerKm % 60)
  return `${minutes}:${seconds.toString().padStart(2, '0')}/km`
}
```

**File**: `components/activities/workout-linker.tsx`
```typescript
'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { supabase, getCurrentAthleteId } from '@/lib/supabase/client'
import { format, parseISO } from 'date-fns'
import type { Activity, PlannedWorkout } from '@/types/database'

interface WorkoutLinkerProps {
  activity: Activity
  currentWorkout?: PlannedWorkout
}

export function WorkoutLinker({ activity, currentWorkout }: WorkoutLinkerProps) {
  const queryClient = useQueryClient()
  const [selectedWorkoutId, setSelectedWorkoutId] = useState<string>()

  // Get nearby workouts (±1 day)
  const { data: nearbyWorkouts } = useQuery({
    queryKey: ['nearby-workouts', activity.id],
    queryFn: async () => {
      if (!activity.start_time) return []

      const activityDate = parseISO(activity.start_time)
      const dayBefore = new Date(activityDate.getTime() - 86400000)
      const dayAfter = new Date(activityDate.getTime() + 86400000)

      const { data } = await supabase
        .from('planned_workouts')
        .select('*')
        .eq('athlete_id', getCurrentAthleteId())
        .gte('scheduled_date', format(dayBefore, 'yyyy-MM-dd'))
        .lte('scheduled_date', format(dayAfter, 'yyyy-MM-dd'))
        .order('scheduled_date', { ascending: true })

      return data || []
    },
  })

  const linkMutation = useMutation({
    mutationFn: async (workoutId: string) => {
      const response = await fetch('/api/activities/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activityId: activity.id,
          workoutId: parseInt(workoutId),
          reason: 'Manual link from activity detail',
        }),
      })
      if (!response.ok) throw new Error('Link failed')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nearby-workouts'] })
    },
  })

  const unlinkMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/activities/link', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activityId: activity.id }),
      })
      if (!response.ok) throw new Error('Unlink failed')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nearby-workouts'] })
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Planned Workout</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {currentWorkout ? (
          <div className="space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-medium">{currentWorkout.description}</div>
                <div className="text-sm text-muted-foreground">
                  {format(parseISO(currentWorkout.scheduled_date), 'PPP')}
                </div>
                {currentWorkout.distance_target_meters && (
                  <div className="text-sm">
                    Target: {(currentWorkout.distance_target_meters / 1000).toFixed(1)} km
                  </div>
                )}
              </div>
              <Badge>{activity.match_method || 'linked'}</Badge>
            </div>

            {activity.match_confidence && (
              <div className="text-sm text-muted-foreground">
                Confidence: {(activity.match_confidence * 100).toFixed(0)}%
              </div>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => unlinkMutation.mutate()}
              disabled={unlinkMutation.isPending}
            >
              {unlinkMutation.isPending ? 'Unlinking...' : 'Unlink'}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Not linked to a planned workout.
            </p>

            {nearbyWorkouts && nearbyWorkouts.length > 0 && (
              <>
                <Select
                  value={selectedWorkoutId}
                  onValueChange={setSelectedWorkoutId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select workout" />
                  </SelectTrigger>
                  <SelectContent>
                    {nearbyWorkouts.map((workout) => (
                      <SelectItem key={workout.id} value={workout.id.toString()}>
                        {format(parseISO(workout.scheduled_date), 'MMM d')} - {workout.description}
                        {workout.distance_target_meters &&
                          ` (${(workout.distance_target_meters / 1000).toFixed(1)} km)`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Button
                  onClick={() => selectedWorkoutId && linkMutation.mutate(selectedWorkoutId)}
                  disabled={!selectedWorkoutId || linkMutation.isPending}
                >
                  {linkMutation.isPending ? 'Linking...' : 'Link'}
                </Button>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
```

**Acceptance Criteria**:
- ✅ Activity detail page shows all metrics
- ✅ Can view linked workout (if any)
- ✅ Can manually link to nearby workouts
- ✅ Can unlink
- ✅ Match confidence displayed

---

## Testing Checklist

### Database
- [ ] Migration runs without errors
- [ ] Columns exist
- [ ] Indexes created
- [ ] Constraints enforced

### Matching Logic
- [ ] Auto-matches same-day activities
- [ ] Confidence scoring accurate
- [ ] Completion status calculated correctly
- [ ] Manual linking works
- [ ] Unlinking works

### UI
- [ ] Calendar shows completion icons
- [ ] Color coding correct
- [ ] Activity detail page displays
- [ ] Workout linker functional
- [ ] Loading states work

### Integration
- [ ] End-to-end: sync → match → display
- [ ] Performance acceptable
- [ ] Error handling robust

---

## Success Criteria

### MVP
- ✅ Activities matched to workouts
- ✅ Completion visible on calendar
- ✅ Manual linking UI works

### Production Ready
- ✅ All MVP features working
- ✅ Mobile responsive
- ✅ No critical bugs
- ✅ Performance acceptable

---

## Phase 6 Complete When

1. All 7 tasks implemented and tested
2. Migration applied to production database
3. Activities visible on calendar underneath workouts
4. Auto-matching working for same-day activities
5. Calendar shows completion status icons
6. Manual linking workflow functional
7. Activity detail page displays correctly

**Estimated Duration**: 4-6 days

**Next Phase**: Phase 7 - Observations & Intelligence
