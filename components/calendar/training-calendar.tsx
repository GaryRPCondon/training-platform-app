'use client'

import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { Calendar, momentLocalizer } from 'react-big-calendar'
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop'
import moment from 'moment'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getPlannedWorkoutsForDateRange, getAthleteProfile, getActivitiesForDateRange, getWorkoutsWithActivities } from '@/lib/supabase/queries'
import { format, startOfMonth, endOfMonth, subDays, addDays, parseISO } from 'date-fns'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { WorkoutCard } from '@/components/review/workout-card'
import { ActivityDetail } from '@/components/activities/activity-detail'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { AlertTriangle, X as XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { getWorkoutColor, normalizeActivityType, isRunningActivityType } from '@/lib/constants/workout-colors'
import { toDisplayDistance, distanceLabel, type UnitSystem } from '@/lib/utils/units'
import { WeeklyTotals } from './weekly-totals'
import { CustomToolbar } from './custom-toolbar'
import { createClient } from '@/lib/supabase/client'
import type { TrainingPaces, StrengthSession } from '@/types/database'
import type { WorkoutWithDetails } from '@/types/review'
import { useRouter } from 'next/navigation'
import { getSessionsForDateRange } from '@/lib/supabase/strength-queries'
import { queryKeys } from '@/lib/query-keys'
import { StrengthCellContext, StrengthDayCellWrapper } from './strength-day-cell-wrapper'
import { SessionDetailDialog } from '@/components/strength/session-detail-dialog'

// Custom styles to enable text wrapping in calendar events (max 2 lines)
const calendarStyles = `
  .rbc-event {
    overflow: hidden !important;
    white-space: nowrap !important;
    text-overflow: ellipsis !important;
    line-height: 1.4 !important;
  }
  .rbc-event-content {
    overflow: hidden !important;
    white-space: nowrap !important;
    text-overflow: ellipsis !important;
  }
  /* Inside the popup overlay, show full event text */
  .rbc-overlay .rbc-event {
    white-space: normal !important;
    text-overflow: unset !important;
  }
  .rbc-overlay .rbc-event-content {
    white-space: normal !important;
    text-overflow: unset !important;
  }
  /* Allow the "+N more" popup to escape overflow clipping */
  .rbc-month-view,
  .rbc-month-row,
  .rbc-row-content {
    overflow: visible !important;
  }
  /* Force RBC Header height to match WeeklyTotals header */
  .rbc-header {
    height: 40px !important;
    line-height: 40px !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    padding: 0 !important;
  }
  /* Remove RBC Month View borders that double up */
  .rbc-month-view {
    border-top: none !important;
  }
  /* Pointer cursor on empty day cells to hint that clicking creates a workout */
  .rbc-day-bg {
    cursor: pointer;
    position: relative;
    padding-bottom: 30px;
  }
  /* Highlight cells while a strength session is being dragged over them. */
  .rbc-day-bg[data-strength-drop-active="true"] {
    background-color: rgba(59, 130, 246, 0.12);
    outline: 2px dashed rgb(59, 130, 246);
    outline-offset: -2px;
  }
`

const QUALITY_WORKOUT_TYPES = new Set(['tempo', 'intervals', 'race_pace', 'race', 'long_run'])

const localizer = momentLocalizer(moment)
const DnDCalendar = withDragAndDrop(Calendar)

function formatWorkoutTitle(workout: any, units: UnitSystem = 'metric'): string {
    const description = workout.description || 'Workout'

    // Add completion status indicator
    let statusIndicator = ''
    if (workout.completion_status === 'completed') {
        statusIndicator = '✓ '
    } else if (workout.completion_status === 'partial') {
        statusIndicator = '⚠ '
    } else if (workout.completion_status === 'skipped') {
        statusIndicator = '✗ '
    }

    // Check if description already contains distance information (e.g., "10km", "15km", "5K")
    const hasDistanceInDescription = /\d+\.?\d*\s?(km|k|miles?|mi)\b/i.test(description)

    if (workout.distance_target_meters && !hasDistanceInDescription) {
        const dist = toDisplayDistance(workout.distance_target_meters, units).toFixed(1)
        const label = distanceLabel(units)
        return `${statusIndicator}${description} ${dist}${label}`
    }

    if (workout.duration_target_seconds) {
        const mins = Math.round(workout.duration_target_seconds / 60)
        return `${statusIndicator}${description} ${mins}min`
    }

    return `${statusIndicator}${description}`
}

function makeNewWorkout(date: Date): WorkoutWithDetails {
    return {
        id: 0,
        athlete_id: '',
        scheduled_date: format(date, 'yyyy-MM-dd'),
        scheduled_time: null,
        workout_type: 'easy_run',
        workout_index: null,
        description: '',
        distance_target_meters: null,
        duration_target_seconds: null,
        intensity_target: null,
        structured_workout: null,
        status: 'scheduled',
        completed_activity_id: null,
        completion_status: 'pending',
        completion_metadata: null,
        agent_rationale: null,
        agent_decision_metadata: null,
        notes: null,
        version: 1,
        created_at: '',
        updated_at: '',
        weekly_plan_id: null,
        date,
        formatted_date: format(date, 'EEE, MMM d'),
        phase_name: 'Active Plan',
        week_of_plan: 0,
    } as WorkoutWithDetails
}

interface TrainingCalendarProps {
    openWorkoutId?: number
    openStrengthSessionId?: number
}

// Normalised result of one Garmin batch endpoint call (running or strength).
// Lets the week handlers fan out to both endpoints and aggregate the outcome
// into a single toast.
interface GarminBatchResult {
    ok: boolean
    sent: number
    deleted: number
    skipped: number
    failed: number
    error?: string       // endpoint-level error (non-2xx response)
    firstError?: string  // first per-item error, e.g. "unsupported exercises"
}

async function postGarminBatch(url: string, body: Record<string, unknown>): Promise<GarminBatchResult> {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    })
    const result = await res.json().catch(() => ({})) as {
        error?: string; sent?: number; deleted?: number; skipped?: number; failed?: number
        errors?: Array<{ error?: string }>
    }
    if (!res.ok) {
        return { ok: false, sent: 0, deleted: 0, skipped: 0, failed: 0, error: result.error || 'Request failed' }
    }
    return {
        ok: true,
        sent: result.sent ?? 0,
        deleted: result.deleted ?? 0,
        skipped: result.skipped ?? 0,
        failed: result.failed ?? 0,
        firstError: result.errors?.[0]?.error,
    }
}

export function TrainingCalendar({ openWorkoutId, openStrengthSessionId }: TrainingCalendarProps = {}) {
    const [currentDate, setCurrentDate] = useState(new Date())
    const [selectedWorkout, setSelectedWorkout] = useState<WorkoutWithDetails | null>(null)
    const [selectedActivity, setSelectedActivity] = useState<any | null>(null)
    const [isWorkoutDialogOpen, setIsWorkoutDialogOpen] = useState(false)
    const [isActivityDialogOpen, setIsActivityDialogOpen] = useState(false)
    const [isAutoMatching, setIsAutoMatching] = useState(false)
    const [createDate, setCreateDate] = useState<Date | null>(null)
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
    const [selectedStrengthSession, setSelectedStrengthSession] = useState<StrengthSession | null>(null)
    const [isStrengthDialogOpen, setIsStrengthDialogOpen] = useState(false)
    const [runningOnly, setRunningOnly] = useState(() => {
        if (typeof window !== 'undefined') {
            return localStorage.getItem('calendar-running-only') === 'true'
        }
        return false
    })

    const handleRunningOnlyChange = useCallback((value: boolean) => {
        setRunningOnly(value)
        localStorage.setItem('calendar-running-only', String(value))
    }, [])
    const queryClient = useQueryClient()
    const supabase = createClient()
    const router = useRouter()

    // Get athlete profile for week start preference
    const { data: athlete } = useQuery({
        queryKey: ['athlete'],
        queryFn: getAthleteProfile,
    })

    const weekStartsOn = (athlete?.week_starts_on ?? 0) as 0 | 1 | 2 | 3 | 4 | 5 | 6 // Default to Sunday if not set
    const preferredUnits: UnitSystem = athlete?.preferred_units ?? 'metric'

    // Get active plan's VDOT and training paces
    const { data: activePlan } = useQuery({
        queryKey: ['active-plan'],
        queryFn: async () => {
            if (!athlete?.id) return null

            const { data, error } = await supabase
                .from('training_plans')
                .select('id, vdot, training_paces')
                .eq('athlete_id', athlete.id)
                .eq('status', 'active')
                .maybeSingle()  // Use maybeSingle() to gracefully handle no active plan

            if (error) {
                console.error('Error loading active plan:', error)
                return null
            }

            // data will be null if no active plan exists (user hasn't accepted a plan yet)
            // This is expected and not an error - WorkoutCard will work without paces
            return data
        },
        enabled: !!athlete?.id
    })

    const garminConnected = !!(athlete?.garmin_connected)

    // Fetch completed plan date ranges so any workout in that window is treated as historical
    const { data: completedPlans } = useQuery({
        queryKey: ['completed-plans'],
        queryFn: async () => {
            if (!athlete?.id) return []
            const { data } = await supabase
                .from('training_plans')
                .select('start_date, end_date')
                .eq('athlete_id', athlete.id)
                .eq('status', 'completed')
            return data ?? []
        },
        enabled: !!athlete?.id,
    })

    // Update moment locale to use the preferred week start day
    moment.updateLocale('en', {
        week: {
            dow: weekStartsOn, // 0 = Sunday, 1 = Monday, etc.
        }
    })

    // Calendar is month-only — always query a month's worth of data with a week buffer
    const queryStart = format(subDays(startOfMonth(currentDate), 7), 'yyyy-MM-dd')
    const queryEnd = format(addDays(endOfMonth(currentDate), 7), 'yyyy-MM-dd')

    const { data: rawWorkouts, error: workoutsError } = useQuery({
        queryKey: ['workouts', queryStart, queryEnd],
        queryFn: () => getWorkoutsWithActivities(queryStart, queryEnd),
    })

    // Log workouts query error
    if (workoutsError) {
        console.error('Workouts query error:', workoutsError)
    }

    // Phase 6: Query activities for the same date range
    const { data: rawActivities } = useQuery({
        queryKey: ['activities', queryStart, queryEnd],
        queryFn: () => getActivitiesForDateRange(queryStart, queryEnd),
    })

    // Strength sessions in the visible window.
    const { data: strengthSessions } = useQuery({
        queryKey: queryKeys.strengthSessions(queryStart, queryEnd),
        queryFn: async () => {
            if (!athlete?.id) return [] as StrengthSession[]
            return getSessionsForDateRange(supabase, athlete.id, queryStart, queryEnd)
        },
        enabled: !!athlete?.id,
    })

    const sessionsByDate = useMemo(() => {
        const map = new Map<string, StrengthSession[]>()
        for (const session of strengthSessions ?? []) {
            const bucket = map.get(session.scheduled_date)
            if (bucket) bucket.push(session)
            else map.set(session.scheduled_date, [session])
        }
        for (const list of map.values()) {
            list.sort((a, b) => (a.display_order ?? 1) - (b.display_order ?? 1) || a.id - b.id)
        }
        return map
    }, [strengthSessions])

    // Convert raw workouts to WorkoutWithDetails format
    const workouts: WorkoutWithDetails[] = useMemo(() => {
        if (!rawWorkouts) return []

        return rawWorkouts.map(workout => {
            // A workout is historical if it structurally belongs to a completed plan (via FK)
            // OR if it falls within any completed plan's date range (covers manually added /
            // rescheduled workouts that don't have a weekly_plan_id link).
            const inCompletedRange = (completedPlans ?? []).some(
                p => workout.scheduled_date >= p.start_date && workout.scheduled_date <= p.end_date
            )
            return {
                ...workout,
                plan_status: workout.plan_status ?? (inCompletedRange ? 'completed' : null),
                date: parseISO(workout.scheduled_date),
                formatted_date: format(parseISO(workout.scheduled_date), 'EEE, MMM d'),
                phase_name: 'Active Plan',
                week_of_plan: 0,
            }
        })
    }, [rawWorkouts, completedPlans])

    // Auto-open workout dialog when navigated with ?workoutId= param
    const openedWorkoutRef = useRef<number | undefined>(undefined)
    useEffect(() => {
        if (!openWorkoutId || !workouts.length || openedWorkoutRef.current === openWorkoutId) return
        const workout = workouts.find(w => w.id === openWorkoutId)
        if (workout) {
            openedWorkoutRef.current = openWorkoutId
            setSelectedWorkout(workout)
            setIsWorkoutDialogOpen(true)
        }
    }, [openWorkoutId, workouts])

    const rescheduleMutation = useMutation({
        mutationFn: async ({ workoutId, newDate }: { workoutId: number, newDate: string }) => {
            const response = await fetch('/api/workouts/reschedule', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workoutId, newDate })
            })
            if (!response.ok) throw new Error('Failed to reschedule')
            return response.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['workouts'] })
            toast.success('Workout rescheduled')
        },
        onError: () => {
            toast.error('Failed to reschedule workout')
        }
    })

    const strengthRescheduleMutation = useMutation({
        mutationFn: async ({ sessionId, newDate, wasSyncedOnGarmin }: { sessionId: number, newDate: string, wasSyncedOnGarmin: boolean }) => {
            const response = await fetch('/api/strength/reschedule', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, newDate }),
            })
            const result = await response.json()
            if (!response.ok) throw new Error(result.error || 'Failed to reschedule')
            return {
                session: result.session as StrengthSession,
                newDate,
                wasSyncedOnGarmin,
                garminMoved: !!result.garminMoved,
            }
        },
        onSuccess: ({ newDate, wasSyncedOnGarmin, garminMoved }) => {
            queryClient.invalidateQueries({ queryKey: ['strength-sessions'] })
            const dateLabel = format(parseISO(newDate), 'EEE, MMM d')
            if (wasSyncedOnGarmin && garminMoved) {
                toast.success(`Moved to ${dateLabel} (Garmin updated)`)
            } else if (wasSyncedOnGarmin && !garminMoved) {
                toast.warning(`Moved to ${dateLabel}. Couldn't update Garmin — resend manually.`)
            } else {
                toast.success('Strength session rescheduled')
            }
        },
        onError: (err: unknown) => {
            toast.error(err instanceof Error ? err.message : 'Failed to reschedule strength session')
        },
    })

    const handleOpenStrengthSession = useCallback((sessionId: number) => {
        const session = (strengthSessions ?? []).find(s => s.id === sessionId)
        if (!session) return
        setSelectedStrengthSession(session)
        setIsStrengthDialogOpen(true)
    }, [strengthSessions])

    // Pending conflict from a strength drop: drives the centered confirm dialog
    // (replaces a sonner toast whose default bottom-right position landed off
    // the usable canvas).
    const [strengthConflict, setStrengthConflict] = useState<{
        sessionId: number
        newDate: string
        conflictLabel: string
    } | null>(null)

    const handleStrengthDrop = useCallback((sessionId: number, newDate: string) => {
        const session = (strengthSessions ?? []).find(s => s.id === sessionId)
        if (!session) return
        if (session.scheduled_date === newDate) return

        const wasSyncedOnGarmin = !!session.garmin_workout_id && session.garmin_sync_status === 'synced'
        const conflict = (workouts || []).find(
            w => w.scheduled_date === newDate && QUALITY_WORKOUT_TYPES.has(w.workout_type as string)
        )
        if (conflict) {
            setStrengthConflict({
                sessionId,
                newDate,
                conflictLabel: `${conflict.description || conflict.workout_type} on ${format(parseISO(newDate), 'EEE, MMM d')}`,
            })
            return
        }
        strengthRescheduleMutation.mutate({ sessionId, newDate, wasSyncedOnGarmin })
    }, [strengthSessions, workouts, strengthRescheduleMutation])

    // Suppress RBC's onSelectSlot when the user is interacting with a strength
    // icon. Two layers of defence (RBC's native handlers bubble through DOM
    // before React's delegate, so React stopPropagation alone is unreliable):
    //   1. strengthClickRef — checked inside onSelectSlot to bail out early.
    //   2. isStrengthDragging state — pipes through `selectable={!isStrengthDragging}`
    //      so RBC never even tracks slot selection during a strength drag.
    const strengthClickRef = useRef(false)
    const strengthClickClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const [isStrengthDragging, setIsStrengthDragging] = useState(false)
    const dragOffTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    const setStrengthSuppression = useCallback((autoClearMs?: number) => {
        strengthClickRef.current = true
        if (strengthClickClearTimer.current) clearTimeout(strengthClickClearTimer.current)
        if (autoClearMs == null) {
            // Persistent — caller is starting a drag and will clear later.
            setIsStrengthDragging(true)
            if (dragOffTimer.current) {
                clearTimeout(dragOffTimer.current)
                dragOffTimer.current = null
            }
        } else {
            strengthClickClearTimer.current = setTimeout(() => {
                strengthClickRef.current = false
                strengthClickClearTimer.current = null
            }, autoClearMs)
            // For drag-end (autoClearMs ~300), defer turning selectable back on
            // so any post-drop synthesised click stays suppressed.
            if (dragOffTimer.current) clearTimeout(dragOffTimer.current)
            dragOffTimer.current = setTimeout(() => {
                setIsStrengthDragging(false)
                dragOffTimer.current = null
            }, autoClearMs)
        }
    }, [])

    const strengthCellValue = useMemo(() => ({
        sessionsByDate,
        onOpen: handleOpenStrengthSession,
        onDragStart: () => { /* reserved for visual feedback in future */ },
        onDragEnd: () => { /* reserved for visual feedback in future */ },
        onDrop: handleStrengthDrop,
        setSuppression: setStrengthSuppression,
    }), [sessionsByDate, handleOpenStrengthSession, handleStrengthDrop, setStrengthSuppression])

    // Auto-open strength dialog when navigated with ?strengthSessionId=
    const openedStrengthRef = useRef<number | undefined>(undefined)
    useEffect(() => {
        if (!openStrengthSessionId || !strengthSessions?.length || openedStrengthRef.current === openStrengthSessionId) return
        const session = strengthSessions.find(s => s.id === openStrengthSessionId)
        if (session) {
            openedStrengthRef.current = openStrengthSessionId
            setSelectedStrengthSession(session)
            setIsStrengthDialogOpen(true)
        }
    }, [openStrengthSessionId, strengthSessions])

    // Phase 6: Auto-match activities mutation
    const handleAutoMatch = useCallback(async () => {
        setIsAutoMatching(true)
        try {
            const response = await fetch('/api/activities/match', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    startDate: queryStart,
                    endDate: queryEnd,
                })
            })

            if (!response.ok) throw new Error('Auto-match failed')

            const result = await response.json()

            // Invalidate queries to refresh data
            queryClient.invalidateQueries({ queryKey: ['workouts'] })
            queryClient.invalidateQueries({ queryKey: ['activities'] })

            toast.success(`Matched ${result.matchCount} ${result.matchCount === 1 ? 'activity' : 'activities'}`)
        } catch (error) {
            console.error('Auto-match error:', error)
            toast.error('Failed to auto-match activities')
        } finally {
            setIsAutoMatching(false)
        }
    }, [queryStart, queryEnd, queryClient])

    // Phase 6: Combine workout and activity events
    const events = useMemo(() => {
        const sortedWorkouts = [...workouts].sort(
            (a, b) =>
                a.scheduled_date.localeCompare(b.scheduled_date) ||
                (a.session_order ?? 1) - (b.session_order ?? 1) ||
                a.id - b.id
        )

        const workoutEvents = sortedWorkouts.map(w => ({
            id: `workout-${w.id}`,
            title: formatWorkoutTitle(w, preferredUnits),
            start: new Date(w.scheduled_date),
            end: new Date(w.scheduled_date),
            allDay: true,
            resource: {
                type: 'workout',
                data: w,
            },
        }))

        const activityEvents = rawActivities
            ?.filter(a => a.start_time)
            .filter(a => !runningOnly || isRunningActivityType(a.activity_type, a.strava_data))
            .map(a => ({
                id: `activity-${a.id}`,
                title: a.activity_name || a.activity_type || 'Activity',
                start: parseISO(a.start_time!),
                end: parseISO(a.start_time!),
                allDay: true,
                resource: {
                    type: 'activity',
                    data: a,
                },
            })) || []

        return [...workoutEvents, ...activityEvents]
    }, [workouts, rawActivities, preferredUnits, runningOnly])

    const handleSelectEvent = useCallback(async (event: any) => {
        // Phase 6: Handle both workouts and activities
        if (event.resource.type === 'workout') {
            setSelectedWorkout(event.resource.data)
            setIsWorkoutDialogOpen(true)
        } else if (event.resource.type === 'activity') {
            // Fetch linked workout if exists
            const activity = event.resource.data
            const activityWithWorkout = { ...activity }

            if (activity.planned_workout_id) {
                const { data: workout } = await supabase
                    .from('planned_workouts')
                    .select('*')
                    .eq('id', activity.planned_workout_id)
                    .single()

                if (workout) {
                    activityWithWorkout.planned_workouts = workout
                }
            }

            setSelectedActivity(activityWithWorkout)
            setIsActivityDialogOpen(true)
        }
    }, [supabase])

    const onEventDrop = useCallback(({ event, start }: any) => {
        // Phase 6: Only allow dragging workouts, not activities
        if (event.resource.type !== 'workout') return

        const newDate = format(start, 'yyyy-MM-dd')
        if (newDate !== event.resource.data.scheduled_date) {
            rescheduleMutation.mutate({
                workoutId: parseInt(event.id.split('-')[1]), // Extract ID from "workout-123"
                newDate
            })
        }
    }, [rescheduleMutation])

    const eventStyleGetter = (event: any) => {
        // Phase 6: Different styling for activities vs workouts
        if (event.resource.type === 'activity') {
            const activity = event.resource.data
            // Matched activities use the linked workout's color; unmatched use normalized activity type
            const matchedWorkout = activity.planned_workout_id
                ? workouts.find(w => w.id === activity.planned_workout_id)
                : null
            const workoutType = matchedWorkout
                ? matchedWorkout.workout_type
                : normalizeActivityType(activity.activity_type, activity.strava_data)
            const backgroundColor = getWorkoutColor(workoutType)

            return {
                style: {
                    backgroundColor,
                    borderLeft: `4px solid ${backgroundColor}`,
                    borderTop: '0px',
                    borderRight: '0px',
                    borderBottom: '0px',
                    borderRadius: '4px',
                    opacity: 0.85,
                    color: '#ffffff', // white text to match planned workouts
                    display: 'block',
                    fontSize: '0.75rem', // Slightly smaller
                    padding: '2px 4px'
                }
            }
        }

        // Workout styling (existing)
        const workout = event.resource.data
        const workoutType = workout?.workout_type || 'default'
        const backgroundColor = getWorkoutColor(workoutType)
        let borderLeft = ''
        let opacity = 0.9
        const isHistorical = workout.plan_status === 'completed'

        // Visual feedback for completion status
        if (workout.completion_status === 'completed') {
            borderLeft = '4px solid #10b981' // green-500
            opacity = isHistorical ? 0.55 : 1.0
        } else if (workout.completion_status === 'partial') {
            borderLeft = '4px solid #f59e0b' // yellow-500
            opacity = isHistorical ? 0.45 : 0.95
        } else if (workout.completion_status === 'skipped') {
            borderLeft = '4px solid #ef4444' // red-500
            opacity = isHistorical ? 0.35 : 0.6
        } else if (isHistorical) {
            opacity = 0.45
        }

        return {
            style: {
                backgroundColor,
                borderRadius: '4px',
                opacity,
                color: 'white',
                borderTop: '0px',
                borderRight: '0px',
                borderBottom: '0px',
                borderLeft: borderLeft || '0px',
                display: 'block',
                fontSize: '0.875rem',
                padding: '2px 4px',
                ...(isHistorical && { filter: 'saturate(0.5)' }),
            }
        }
    }

    const handleNavigate = (action: 'PREV' | 'NEXT' | 'TODAY') => {
        const newDate = new Date(currentDate)
        if (action === 'TODAY') {
            setCurrentDate(new Date())
        } else if (action === 'PREV') {
            newDate.setMonth(newDate.getMonth() - 1)
            setCurrentDate(newDate)
        } else if (action === 'NEXT') {
            newDate.setMonth(newDate.getMonth() + 1)
            setCurrentDate(newDate)
        }
    }

    // One "Send to Garmin" for everything that week: running workouts AND
    // strength sessions, fanned out to their separate batch endpoints and
    // aggregated into a single toast.
    const handleSendWeekToGarmin = useCallback(async (weekStart: Date, weekEnd: Date) => {
        const inWeek = (raw: string) => {
            const d = new Date(raw)
            return d >= weekStart && d <= weekEnd
        }
        const weekWorkoutIds = (workouts || [])
            .filter(w => inWeek(w.scheduled_date) && w.workout_type !== 'rest')
            .map(w => w.id)
        const weekStrengthIds = (strengthSessions || [])
            .filter(s => inWeek(s.scheduled_date))
            .map(s => s.id)

        if (weekWorkoutIds.length === 0 && weekStrengthIds.length === 0) {
            toast.error('No workouts to send this week')
            return
        }

        try {
            const calls: Promise<GarminBatchResult>[] = []
            if (weekWorkoutIds.length) {
                calls.push(postGarminBatch('/api/garmin/workouts', { workoutIds: weekWorkoutIds, action: 'send' }))
            }
            if (weekStrengthIds.length) {
                calls.push(postGarminBatch('/api/garmin/strength-workouts', { sessionIds: weekStrengthIds, action: 'send' }))
            }
            const results = await Promise.all(calls)
            queryClient.invalidateQueries({ queryKey: ['workouts'] })
            queryClient.invalidateQueries({ queryKey: ['strength-sessions'] })

            const sent = results.reduce((n, r) => n + r.sent, 0)
            const skipped = results.reduce((n, r) => n + r.skipped + r.failed, 0)
            if (sent === 0) {
                const reason = results.find(r => !r.ok)?.error
                    ?? results.find(r => r.firstError)?.firstError
                toast.error(reason ?? 'Nothing was sent to Garmin')
                return
            }
            let msg = `Sent ${sent} workout${sent !== 1 ? 's' : ''} to Garmin`
            if (skipped > 0) {
                const detail = results.find(r => r.firstError)?.firstError
                msg += ` · ${skipped} skipped${detail ? ` (${detail})` : ''}`
            }
            toast.success(msg)
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Failed to send to Garmin')
        }
    }, [workouts, strengthSessions, queryClient])

    const handleRemoveWeekFromGarmin = useCallback(async (weekStart: Date, weekEnd: Date) => {
        const inWeek = (raw: string) => {
            const d = new Date(raw)
            return d >= weekStart && d <= weekEnd
        }
        const weekWorkoutIds = (workouts || [])
            .filter(w => inWeek(w.scheduled_date) && w.garmin_workout_id)
            .map(w => w.id)
        const weekStrengthIds = (strengthSessions || [])
            .filter(s => inWeek(s.scheduled_date) && s.garmin_workout_id)
            .map(s => s.id)

        if (weekWorkoutIds.length === 0 && weekStrengthIds.length === 0) {
            toast.error('No synced workouts to remove this week')
            return
        }

        try {
            const calls: Promise<GarminBatchResult>[] = []
            if (weekWorkoutIds.length) {
                calls.push(postGarminBatch('/api/garmin/workouts', { workoutIds: weekWorkoutIds, action: 'delete' }))
            }
            if (weekStrengthIds.length) {
                calls.push(postGarminBatch('/api/garmin/strength-workouts', { sessionIds: weekStrengthIds, action: 'delete' }))
            }
            const results = await Promise.all(calls)
            queryClient.invalidateQueries({ queryKey: ['workouts'] })
            queryClient.invalidateQueries({ queryKey: ['strength-sessions'] })

            const deleted = results.reduce((n, r) => n + r.deleted, 0)
            if (deleted === 0) {
                toast.error(results.find(r => !r.ok)?.error ?? 'Nothing was removed from Garmin')
                return
            }
            toast.success(`Removed ${deleted} workout${deleted !== 1 ? 's' : ''} from Garmin`)
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Failed to remove from Garmin')
        }
    }, [workouts, strengthSessions, queryClient])

    const handleRemoveFromGarmin = useCallback(async (workoutId: number) => {
        try {
            const response = await fetch('/api/garmin/workouts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workoutIds: [workoutId], action: 'delete' }),
            })
            const result = await response.json()
            if (!response.ok) throw new Error(result.error || 'Failed to remove')
            queryClient.invalidateQueries({ queryKey: ['workouts'] })
            toast.success('Removed from Garmin')
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Failed to remove from Garmin')
        }
    }, [queryClient])

    return (
        <div className="h-full w-full flex flex-col overflow-hidden">
            <CustomToolbar
                date={currentDate}
                onNavigate={handleNavigate}
                onAutoMatch={handleAutoMatch}
                isAutoMatching={isAutoMatching}
                runningOnly={runningOnly}
                onRunningOnlyChange={handleRunningOnlyChange}
            />

            <div className="flex-1 w-full flex flex-col landscape:grid landscape:grid-cols-[1fr_220px] md:grid md:grid-cols-[1fr_220px] overflow-visible landscape:overflow-hidden md:overflow-hidden rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-black/8 dark:ring-white/20 dark:shadow-[0_8px_30px_rgb(0,0,0,0.35)]">
                <div className="h-[550px] landscape:h-full md:h-full w-full bg-background overflow-visible relative min-w-0 border-b landscape:border-b-0 landscape:border-r md:border-b-0 md:border-r">
                    <style>{calendarStyles}</style>

                    {/* Centered inline confirmation for strength reschedule conflicts.
                        Replaces a sonner toast (off-screen on this layout) and an
                        AlertDialog (centered on viewport, which is not the visual
                        center of the calendar canvas because of the sidebar). */}
                    {strengthConflict && (
                        <div
                            role="alertdialog"
                            aria-label="Quality session conflict"
                            className="absolute left-1/2 top-4 z-50 -translate-x-1/2 w-[min(420px,calc(100%-2rem))] rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg"
                        >
                            <div className="flex items-start gap-3">
                                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                                <div className="min-w-0 flex-1">
                                    <div className="text-sm font-semibold">Quality session conflict</div>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                        {strengthConflict.conflictLabel} is scheduled here. Strength training the same day may compromise it.
                                    </p>
                                    <div className="mt-3 flex justify-end gap-2">
                                        <Button variant="ghost" size="sm" onClick={() => setStrengthConflict(null)}>
                                            Cancel
                                        </Button>
                                        <Button
                                            size="sm"
                                            onClick={() => {
                                                if (strengthConflict) {
                                                    const conflictSession = (strengthSessions ?? []).find(s => s.id === strengthConflict.sessionId)
                                                    const wasSyncedOnGarmin = !!conflictSession?.garmin_workout_id && conflictSession?.garmin_sync_status === 'synced'
                                                    strengthRescheduleMutation.mutate({
                                                        sessionId: strengthConflict.sessionId,
                                                        newDate: strengthConflict.newDate,
                                                        wasSyncedOnGarmin,
                                                    })
                                                }
                                                setStrengthConflict(null)
                                            }}
                                        >
                                            Move anyway
                                        </Button>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setStrengthConflict(null)}
                                    aria-label="Dismiss"
                                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                                >
                                    <XIcon className="h-4 w-4" />
                                </button>
                            </div>
                        </div>
                    )}

                    <StrengthCellContext.Provider value={strengthCellValue}>
                        <DnDCalendar
                            localizer={localizer}
                            events={events}
                            startAccessor={(event: any) => event.start}
                            endAccessor={(event: any) => event.end}
                            onSelectEvent={handleSelectEvent}
                            onSelectSlot={(slot: any) => {
                                if (strengthClickRef.current) return
                                setCreateDate(slot.start)
                                setIsCreateDialogOpen(true)
                            }}
                            selectable={!isStrengthDragging}
                            date={currentDate}
                            onNavigate={setCurrentDate}
                            view="month"
                            views={['month']}
                            defaultView="month"
                            style={{ height: '100%', width: '100%' }}
                            onEventDrop={onEventDrop}
                            draggableAccessor={() => true}
                            resizable={false}
                            eventPropGetter={eventStyleGetter}
                            toolbar={false}
                            popup={true}
                            components={{ dateCellWrapper: StrengthDayCellWrapper }}
                        />
                    </StrengthCellContext.Provider>
                </div>

                <WeeklyTotals
                    workouts={workouts || []}
                    activities={rawActivities || []}
                    currentDate={currentDate}
                    weekStartsOn={weekStartsOn}
                    showActual={true}
                    garminConnected={garminConnected ?? false}
                    onSendToGarmin={handleSendWeekToGarmin}
                    onRemoveFromGarmin={handleRemoveWeekFromGarmin}
                    strengthSessions={strengthSessions || []}
                    runningOnly={runningOnly}
                />
            </div>

            {/* Workout Dialog */}
            <Dialog open={isWorkoutDialogOpen} onOpenChange={setIsWorkoutDialogOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogTitle className="sr-only">Workout Details</DialogTitle>
                    {selectedWorkout && (
                        <WorkoutCard
                            workout={selectedWorkout}
                            trainingPaces={activePlan?.training_paces || null}
                            vdot={activePlan?.vdot || null}
                            onClose={() => setIsWorkoutDialogOpen(false)}
                            editable={true}
                            siblings={workouts.filter(
                                w => w.scheduled_date === selectedWorkout.scheduled_date && w.id !== selectedWorkout.id
                            )}
                            onSplitChanged={() => {
                                setIsWorkoutDialogOpen(false)
                                queryClient.invalidateQueries({ queryKey: ['workouts'] })
                            }}
                            onSaved={(updated) => {
                                setSelectedWorkout(updated)
                                queryClient.invalidateQueries({ queryKey: ['workouts'] })
                            }}
                            garminConnected={garminConnected}
                            onSendToGarmin={async (workoutId) => {
                                const response = await fetch('/api/garmin/workouts', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ workoutIds: [workoutId], action: 'send' }),
                                })
                                const result = await response.json()
                                if (!response.ok) throw new Error(result.error || 'Failed to send')
                                queryClient.invalidateQueries({ queryKey: ['workouts'] })
                                toast.success('Sent to Garmin')
                            }}
                            onRemoveFromGarmin={handleRemoveFromGarmin}
                            onDiscuss={(workout) => {
                                setIsWorkoutDialogOpen(false)
                                router.push(`/dashboard/chat?workoutId=${workout.id}`)
                            }}
                            onDeleted={() => {
                                setIsWorkoutDialogOpen(false)
                                queryClient.invalidateQueries({ queryKey: ['workouts'] })
                            }}
                        />
                    )}
                </DialogContent>
            </Dialog>

            {/* Create Workout Dialog */}
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogTitle className="sr-only">Create Workout</DialogTitle>
                    {createDate && (
                        <WorkoutCard
                            workout={makeNewWorkout(createDate)}
                            isNew={true}
                            trainingPaces={activePlan?.training_paces || null}
                            vdot={activePlan?.vdot || null}
                            editable={true}
                            onClose={() => setIsCreateDialogOpen(false)}
                            onCreated={() => setIsCreateDialogOpen(false)}
                        />
                    )}
                </DialogContent>
            </Dialog>

            {/* Strength Session Dialog */}
            <Dialog open={isStrengthDialogOpen} onOpenChange={setIsStrengthDialogOpen}>
                <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
                    <DialogTitle className="sr-only">Strength Session Details</DialogTitle>
                    {selectedStrengthSession && (
                        <SessionDetailDialog
                            session={selectedStrengthSession}
                            onClose={() => setIsStrengthDialogOpen(false)}
                            onSaved={(updated) => {
                                setSelectedStrengthSession(updated)
                                queryClient.invalidateQueries({ queryKey: ['strength-sessions'] })
                            }}
                            onDeleted={() => {
                                setIsStrengthDialogOpen(false)
                                queryClient.invalidateQueries({ queryKey: ['strength-sessions'] })
                            }}
                        />
                    )}
                </DialogContent>
            </Dialog>


            {/* Activity Dialog */}
            <Dialog open={isActivityDialogOpen} onOpenChange={setIsActivityDialogOpen}>
                <DialogContent className="sm:max-w-[595px] max-h-[90vh] overflow-y-auto">
                    <DialogTitle className="sr-only">Activity Details</DialogTitle>
                    {selectedActivity && (
                        <>
                            <ActivityDetail
                                activity={selectedActivity}
                                onClose={() => setIsActivityDialogOpen(false)}
                            />
                            <div className="flex justify-end pt-4 border-t">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                        setIsActivityDialogOpen(false)
                                        router.push(`/dashboard/activities/${selectedActivity.id}`)
                                    }}
                                >
                                    View Full Details
                                </Button>
                            </div>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    )
}
