'use client'

import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { Calendar } from 'react-big-calendar'
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop'
import { createCalendarLocalizer } from '@/lib/utils/calendar-localizer'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getAthleteProfile, getActivitiesForDateRange, getWorkoutsWithActivities } from '@/lib/supabase/queries'
import { format, startOfMonth, endOfMonth, subDays, addDays, parseISO } from 'date-fns'
import { Button } from '@/components/ui/button'
import { WorkoutCard } from '@/components/review/workout-card'
import { ActivityDetail } from '@/components/activities/activity-detail'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Activity as ActivityIcon, AlertTriangle, Dumbbell, X as XIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { getWorkoutColor, normalizeActivityType, isRunningActivityType } from '@/lib/constants/workout-colors'
import { toDisplayDistance, distanceLabel, formatDistance, formatPace, formatHms, type UnitSystem } from '@/lib/utils/units'
import { WeeklyTotals } from './weekly-totals'
import { CustomToolbar } from './custom-toolbar'
import { useMediaQuery } from '@/lib/hooks/use-media-query'
import { createClient } from '@/lib/supabase/client'
import type { StrengthSession } from '@/types/database'
import type { WorkoutWithDetails } from '@/types/review'
import type { Activity, PlannedWorkout } from '@/types/database'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getSessionsForDateRange } from '@/lib/supabase/strength-queries'
import { queryKeys } from '@/lib/query-keys'
import { StrengthCellContext, StrengthDayCellWrapper } from './strength-day-cell-wrapper'
import { strengthStatusClasses } from './strength-icon-strip'
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

type CalendarEvent = {
    id: string
    start: Date
    end: Date
    title?: string
    allDay?: boolean
    resource:
        | { type: 'workout'; data: WorkoutWithDetails }
        | { type: 'activity'; data: Activity }
}

// One line in the mobile agenda: a workout/activity event (activities linked to the
// workout above are `nested` → indented) or a strength session.
type MobileRow =
    | { kind: 'event'; id: string; event: CalendarEvent; nested: boolean }
    | { kind: 'strength'; id: string; session: StrengthSession }

const DnDCalendar = withDragAndDrop<CalendarEvent>(Calendar)

// Stable accessor identities so RBC isn't handed new functions every render.
const eventStartAccessor = (event: CalendarEvent) => event.start
const eventEndAccessor = (event: CalendarEvent) => event.end

function formatWorkoutTitle(workout: WorkoutWithDetails, units: UnitSystem = 'metric'): string {
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

// What was actually run, for the mobile agenda's nested activity row. The planned
// row directly above already carries the prescription and the name ("Morning Run")
// says nothing, so this line is the numbers: distance and pace.
function formatActivityActuals(activity: Activity, units: UnitSystem): string | null {
    const meters = activity.distance_meters
    const seconds = activity.moving_duration_seconds ?? activity.duration_seconds
    const parts: string[] = []
    if (meters) parts.push(formatDistance(meters, units, 1))
    if (meters && seconds) parts.push(formatPace(seconds / (meters / 1000), units))
    else if (seconds) parts.push(formatHms(seconds))
    return parts.length ? parts.join(' · ') : null
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
    // Demo tour: auto-open a representative card of the given kind. Uses a kind
    // (not an id) so it survives the demo's nightly reclone, which remaps all ids.
    tourOpen?: 'workout' | 'activity' | 'strength'
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

export function TrainingCalendar({ openWorkoutId, openStrengthSessionId, tourOpen }: TrainingCalendarProps = {}) {
    const t = useTranslations('calendar')
    const [currentDate, setCurrentDate] = useState(new Date())
    // On mobile the month grid squeezes 7 columns into ~390px, making workout
    // details unreadable. Below this breakpoint we render a custom day-grouped
    // list (see `mobileDays` + the render branch) instead of the calendar grid;
    // desktop keeps the month view unchanged.
    const isMobile = useMediaQuery('(max-width: 767px)')
    const [selectedWorkout, setSelectedWorkout] = useState<WorkoutWithDetails | null>(null)
    const [selectedActivity, setSelectedActivity] = useState<(Activity & { planned_workouts?: PlannedWorkout | null }) | null>(null)
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

    // Mobile-only: hide synced activities so the list reads as the plan for the month.
    // Defaults to on — the day rows still show completion state (✓ / ⚠ / ✗) without them.
    const [plannedOnly, setPlannedOnly] = useState(() => {
        if (typeof window !== 'undefined') {
            return localStorage.getItem('calendar-planned-only') !== 'false'
        }
        return true
    })

    const handleRunningOnlyChange = useCallback((value: boolean) => {
        setRunningOnly(value)
        localStorage.setItem('calendar-running-only', String(value))
    }, [])

    const handlePlannedOnlyChange = useCallback((value: boolean) => {
        setPlannedOnly(value)
        localStorage.setItem('calendar-planned-only', String(value))
    }, [])

    // Stable for the lifetime of the mount — the agenda highlight/scroll anchor.
    const todayKey = useMemo(() => format(new Date(), 'yyyy-MM-dd'), [])
    const queryClient = useQueryClient()
    const supabase = createClient()
    const router = useRouter()

    // Get athlete profile for week start preference
    const { data: athlete, isLoading: isAthleteLoading } = useQuery({
        queryKey: ['athlete'],
        queryFn: getAthleteProfile,
    })

    const weekStartsOn = (athlete?.week_starts_on ?? 0) as 0 | 1 | 2 | 3 | 4 | 5 | 6 // Default to Sunday if not set
    const preferredUnits: UnitSystem = athlete?.preferred_units ?? 'metric'

    // date-fns localizer carrying the athlete's week-start preference (replaces
    // the old moment.updateLocale mutation in the render body).
    const localizer = useMemo(() => createCalendarLocalizer(weekStartsOn), [weekStartsOn])

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

    // Demo tour: auto-open a representative card for the requested kind. Picks an
    // item by kind (a quality workout / a linked completed activity / a strength
    // session) rather than a fixed id, so it survives the nightly reclone. Closes
    // the other cards so only one is ever open; clears them when the tour leaves.
    const openedTourRef = useRef<string | undefined>(undefined)
    const tourSeekRef = useRef<string | undefined>(undefined)
    useEffect(() => {
        const target = tourOpen ?? ''
        if (openedTourRef.current === target) return

        if (!tourOpen) {
            setIsWorkoutDialogOpen(false)
            setIsActivityDialogOpen(false)
            setIsStrengthDialogOpen(false)
            openedTourRef.current = target
            tourSeekRef.current = undefined
            return
        }

        // Fallback: when the visible month has no item of the requested kind, jump
        // the calendar to the month of the most-recent one (i.e. look back through
        // history), then let this effect re-run and open it. Runs at most once per
        // tour stop, so a kind with NO data anywhere is a graceful no-op.
        const seekMonth = async (table: 'planned_workouts' | 'activities' | 'strength_sessions', dateCol: string, excludeRest: boolean) => {
            if (tourSeekRef.current === target || !athlete?.id) return
            tourSeekRef.current = target
            const base = supabase.from(table).select(dateCol).eq('athlete_id', athlete.id)
            const filtered = excludeRest ? base.neq('workout_type', 'rest') : base
            const { data } = await filtered.order(dateCol, { ascending: false }).limit(1)
            const row = data?.[0] as Record<string, string> | undefined
            if (row?.[dateCol]) setCurrentDate(new Date(row[dateCol]))
        }

        if (tourOpen === 'workout') {
            if (!workouts.length) { void seekMonth('planned_workouts', 'scheduled_date', true); return }
            const QUALITY = new Set<string>(['intervals', 'tempo', 'race'])
            const workout = workouts.find(w => QUALITY.has(w.workout_type))
                ?? workouts.find(w => w.workout_type !== 'rest')
                ?? workouts[0]
            setIsActivityDialogOpen(false)
            setIsStrengthDialogOpen(false)
            setSelectedWorkout(workout)
            setIsWorkoutDialogOpen(true)
            openedTourRef.current = target
        } else if (tourOpen === 'activity') {
            if (!rawActivities?.length) { void seekMonth('activities', 'start_time', false); return }
            // Prefer the most recent activity linked to a planned workout (best for
            // the "compared against the plan" story), else the most recent overall.
            const linked = [...rawActivities].reverse().find(a => a.planned_workout_id)
            const activity = linked ?? rawActivities[rawActivities.length - 1]
            setIsWorkoutDialogOpen(false)
            setIsStrengthDialogOpen(false)
            openedTourRef.current = target
            void (async () => {
                const withWorkout: Activity & { planned_workouts?: PlannedWorkout | null } = { ...activity }
                if (activity.planned_workout_id) {
                    const { data: workout } = await supabase
                        .from('planned_workouts')
                        .select('*')
                        .eq('id', activity.planned_workout_id)
                        .single()
                    if (workout) withWorkout.planned_workouts = workout
                }
                setSelectedActivity(withWorkout)
                setIsActivityDialogOpen(true)
            })()
        } else if (tourOpen === 'strength') {
            if (!strengthSessions?.length) { void seekMonth('strength_sessions', 'scheduled_date', false); return }
            setIsWorkoutDialogOpen(false)
            setIsActivityDialogOpen(false)
            setSelectedStrengthSession(strengthSessions[0])
            setIsStrengthDialogOpen(true)
            openedTourRef.current = target
        }
    }, [tourOpen, workouts, rawActivities, strengthSessions, athlete?.id, supabase])

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
            toast.success(t('workoutRescheduled'))
        },
        onError: () => {
            toast.error(t('rescheduleFailed'))
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
                toast.success(t('movedGarminUpdated', { date: dateLabel }))
            } else if (wasSyncedOnGarmin && !garminMoved) {
                toast.warning(t('movedGarminFailed', { date: dateLabel }))
            } else {
                toast.success(t('strengthRescheduled'))
            }
        },
        onError: (err: unknown) => {
            toast.error(err instanceof Error ? err.message : t('strengthRescheduleFailed'))
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

            toast.success(t('matched', { count: result.matchCount }))
        } catch (error) {
            console.error('Auto-match error:', error)
            toast.error(t('autoMatchFailed'))
        } finally {
            setIsAutoMatching(false)
        }
    }, [queryStart, queryEnd, queryClient, t])

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
            start: parseISO(w.scheduled_date),
            end: parseISO(w.scheduled_date),
            allDay: true,
            resource: {
                type: 'workout' as const,
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
                    type: 'activity' as const,
                    data: a,
                },
            })) || []

        return [...workoutEvents, ...activityEvents]
    }, [workouts, rawActivities, preferredUnits, runningOnly])

    // This month's events grouped by day, for the mobile list view. Chronological.
    //
    // Each day's rows are ordered planned-workout-first with any activity that is
    // linked to that workout nested underneath it (`nested: true` → indented), so the
    // plan/actual relationship is readable without the desktop side-by-side layout.
    // Unlinked activities land at the end of the day, un-indented — and are the only
    // thing `plannedOnly` hides: a matched activity's nested row is the sole way into
    // the actual result on mobile, since the workout card shows the plan, not the run.
    // Strength sessions get their own row per day (the desktop icon strip has no
    // equivalent here — a list row is a bigger tap target and can show the title).
    const mobileDays = useMemo(() => {
        const monthStartKey = format(startOfMonth(currentDate), 'yyyy-MM-dd')
        const monthEndKey = format(endOfMonth(currentDate), 'yyyy-MM-dd')
        const inMonth = (key: string) => key >= monthStartKey && key <= monthEndKey

        const groups = new Map<string, CalendarEvent[]>()
        for (const ev of [...events].sort((a, b) => a.start.getTime() - b.start.getTime())) {
            const key = format(ev.start, 'yyyy-MM-dd')
            if (!inMonth(key)) continue
            const list = groups.get(key)
            if (list) list.push(ev)
            else groups.set(key, [ev])
        }

        const dayKeys = new Set(groups.keys())
        // Strength-only days would otherwise be missing from the list entirely.
        for (const key of sessionsByDate.keys()) if (inMonth(key)) dayKeys.add(key)
        // Always emit a row for today (even when empty) so the "today" highlight and
        // the auto-scroll below have something to anchor on.
        if (inMonth(todayKey)) dayKeys.add(todayKey)

        return [...dayKeys]
            .sort((a, b) => a.localeCompare(b))
            .map(key => {
                const dayEvents = groups.get(key) ?? []
                const workoutEvents = dayEvents.filter(ev => ev.resource.type === 'workout')
                const activityEvents = dayEvents.filter(ev => ev.resource.type === 'activity')

                const rows: MobileRow[] = []
                const nestedIds = new Set<string>()
                for (const workout of workoutEvents) {
                    rows.push({ kind: 'event', id: workout.id, event: workout, nested: false })
                    const workoutId = workout.resource.data.id
                    for (const activity of activityEvents) {
                        if ((activity.resource.data as Activity).planned_workout_id === workoutId) {
                            nestedIds.add(activity.id)
                            rows.push({ kind: 'event', id: activity.id, event: activity, nested: true })
                        }
                    }
                }
                if (!plannedOnly) {
                    for (const activity of activityEvents) {
                        if (!nestedIds.has(activity.id)) {
                            rows.push({ kind: 'event', id: activity.id, event: activity, nested: false })
                        }
                    }
                }
                for (const session of sessionsByDate.get(key) ?? []) {
                    rows.push({ kind: 'strength', id: `strength-${session.id}`, session })
                }

                return { key, rows, isToday: key === todayKey }
            })
    }, [events, sessionsByDate, currentDate, todayKey, plannedOnly])

    // Centre the mobile list on today whenever the visible month changes to one that
    // contains today (including first paint), so the user never has to hunt for it.
    const todayRowRef = useRef<HTMLDivElement | null>(null)
    const scrolledMonthRef = useRef<string | null>(null)
    useEffect(() => {
        // Wait for both queries to resolve: mobileDays is never empty when today is in
        // view (it synthesises a row for today), so scrolling before the data lands
        // would centre a one-row list and then mark the month as done.
        if (!isMobile || !rawWorkouts || !rawActivities) return
        const monthKey = format(currentDate, 'yyyy-MM')
        if (scrolledMonthRef.current === monthKey) return
        scrolledMonthRef.current = monthKey
        todayRowRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, [isMobile, currentDate, mobileDays, rawWorkouts, rawActivities])

    const handleSelectEvent = useCallback(async (event: CalendarEvent) => {
        // Phase 6: Handle both workouts and activities
        if (event.resource.type === 'workout') {
            setSelectedWorkout(event.resource.data)
            setIsWorkoutDialogOpen(true)
        } else if (event.resource.type === 'activity') {
            // Fetch linked workout if exists
            const activity = event.resource.data
            const activityWithWorkout: Activity & { planned_workouts?: PlannedWorkout | null } = { ...activity }

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

    const onEventDrop = useCallback(({ event, start }: { event: CalendarEvent; start: string | Date }) => {
        // Phase 6: Only allow dragging workouts, not activities
        if (event.resource.type !== 'workout') return

        const newDate = format(new Date(start), 'yyyy-MM-dd')
        if (newDate !== event.resource.data.scheduled_date) {
            rescheduleMutation.mutate({
                workoutId: parseInt(event.id.split('-')[1]), // Extract ID from "workout-123"
                newDate
            })
        }
    }, [rescheduleMutation])

    // Index workouts by id once so the per-event style getter is an O(1) lookup
    // instead of a linear find() per event (which defeated RBC memoization).
    const workoutsById = useMemo(
        () => new Map((workouts ?? []).map(w => [w.id, w])),
        [workouts]
    )

    const eventStyleGetter = useCallback((event: CalendarEvent) => {
        // Phase 6: Different styling for activities vs workouts
        if (event.resource.type === 'activity') {
            const activity = event.resource.data
            // Matched activities use the linked workout's color; unmatched use normalized activity type
            const matchedWorkout = activity.planned_workout_id
                ? workoutsById.get(activity.planned_workout_id)
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
    }, [workoutsById])

    const handleNavigate = (action: 'PREV' | 'NEXT' | 'TODAY') => {
        const newDate = new Date(currentDate)
        if (action === 'TODAY') {
            setCurrentDate(new Date())
            // Already on this month? The scroll effect below won't re-run, so re-centre
            // the mobile agenda on today explicitly.
            requestAnimationFrame(() => todayRowRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
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
            toast.error(t('noWorkoutsToSend'))
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
                toast.error(reason ?? t('nothingSent'))
                return
            }
            let msg = t('sentSummary', { count: sent })
            if (skipped > 0) {
                const detail = results.find(r => r.firstError)?.firstError
                msg += detail
                    ? t('skippedSuffixDetail', { count: skipped, detail })
                    : t('skippedSuffix', { count: skipped })
            }
            toast.success(msg)
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : t('sendFailed'))
        }
    }, [workouts, strengthSessions, queryClient, t])

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
            toast.error(t('noSyncedToRemove'))
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
                toast.error(results.find(r => !r.ok)?.error ?? t('nothingRemoved'))
                return
            }
            toast.success(t('removedSummary', { count: deleted }))
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : t('removeFailed'))
        }
    }, [workouts, strengthSessions, queryClient, t])

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
            toast.success(t('removedFromGarmin'))
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : t('removeFailed'))
        }
    }, [queryClient, t])

    // On a tour stop the mobile tour bar is pinned to the bottom of the viewport, so
    // a card centred on the full viewport would run behind it. `--tour-bar-h` (set by
    // the bar, absent elsewhere → 0px) shrinks and re-centres the card above it.
    const tourDialogClass = tourOpen
        ? 'max-h-[calc(90dvh_-_var(--tour-bar-h,0px))] top-[calc(50%_-_var(--tour-bar-h,0px)_/_2)]'
        : 'max-h-[90dvh]'

    // Hold the first paint until the athlete's week-start preference is known —
    // rendering with the Sunday default first makes the grid visibly re-flow to
    // Monday once the profile query resolves.
    if (isAthleteLoading) {
        return <Skeleton className="h-full min-h-[500px] w-full rounded-md" />
    }

    return (
        <div className="h-full w-full flex flex-col overflow-hidden">
            <CustomToolbar
                date={currentDate}
                onNavigate={handleNavigate}
                onAutoMatch={handleAutoMatch}
                isAutoMatching={isAutoMatching}
                runningOnly={runningOnly}
                onRunningOnlyChange={handleRunningOnlyChange}
                plannedOnly={isMobile ? plannedOnly : undefined}
                onPlannedOnlyChange={isMobile ? handlePlannedOnlyChange : undefined}
            />

            {isMobile ? (
                <div className="flex-1 min-h-0 overflow-y-auto mt-1 pb-4">
                    {mobileDays.length === 0 ? (
                        <p className="px-1 py-10 text-center text-sm text-muted-foreground">{t('noWorkoutsThisMonth')}</p>
                    ) : (
                        <div className="space-y-4">
                            {mobileDays.map(({ key, rows, isToday }) => (
                                <div
                                    key={key}
                                    ref={isToday ? todayRowRef : undefined}
                                    className={cn(
                                        'scroll-mt-4',
                                        isToday && 'rounded-xl bg-primary/10 p-2 ring-2 ring-primary'
                                    )}
                                >
                                    <div className="mb-1.5 flex items-center gap-2 px-1 text-sm font-semibold">
                                        {isToday && (
                                            <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-primary-foreground">
                                                {t('today')}
                                            </span>
                                        )}
                                        <span className={isToday ? 'text-foreground' : 'text-muted-foreground'}>
                                            {format(parseISO(key), 'EEEE, MMM d')}
                                        </span>
                                    </div>
                                    {rows.length === 0 ? (
                                        <p className="px-1 py-1 text-sm text-muted-foreground">{t('nothingScheduled')}</p>
                                    ) : (
                                        <div className="space-y-1.5">
                                            {rows.map(row => {
                                                if (row.kind === 'strength') {
                                                    const { session } = row
                                                    return (
                                                        <button
                                                            key={row.id}
                                                            type="button"
                                                            onClick={() => handleOpenStrengthSession(session.id)}
                                                            className={cn(
                                                                'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition-opacity active:opacity-80',
                                                                strengthStatusClasses(session.completion_status)
                                                            )}
                                                        >
                                                            <Dumbbell className="h-4 w-4 shrink-0" aria-hidden="true" />
                                                            <span className="min-w-0 flex-1 truncate">{session.title}</span>
                                                            {session.estimated_duration_minutes != null && (
                                                                <span className="shrink-0 text-xs opacity-80">
                                                                    {t('durationMin', { min: session.estimated_duration_minutes })}
                                                                </span>
                                                            )}
                                                        </button>
                                                    )
                                                }
                                                const { event: ev, nested } = row
                                                const s = eventStyleGetter(ev).style
                                                const activity = ev.resource.type === 'activity' ? ev.resource.data : null
                                                // Nested rows read as the plan's "actual", so lead with the
                                                // numbers; standalone ones still need their name to identify them.
                                                const actuals = nested && activity ? formatActivityActuals(activity, preferredUnits) : null
                                                return (
                                                    <button
                                                        key={row.id}
                                                        type="button"
                                                        onClick={() => handleSelectEvent(ev)}
                                                        className={cn(
                                                            'flex w-full items-center gap-1.5 rounded-lg px-3 text-left shadow-sm transition-opacity active:opacity-80',
                                                            activity ? 'py-2 text-xs font-normal' : 'py-2.5 text-sm font-medium',
                                                            nested && 'ms-6 w-[calc(100%-1.5rem)]'
                                                        )}
                                                        style={{
                                                            backgroundColor: s.backgroundColor,
                                                            borderLeft: s.borderLeft,
                                                            opacity: s.opacity,
                                                            color: s.color,
                                                        }}
                                                    >
                                                        {activity && (
                                                            <>
                                                                <ActivityIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                                                <span className="sr-only">{t('activityLabel')}</span>
                                                            </>
                                                        )}
                                                        <span className="min-w-0 truncate">{actuals ?? ev.title}</span>
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            ) : (
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
                            aria-label={t('qualityConflict')}
                            className="absolute left-1/2 top-4 z-50 -translate-x-1/2 w-[min(420px,calc(100%-2rem))] rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg"
                        >
                            <div className="flex items-start gap-3">
                                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                                <div className="min-w-0 flex-1">
                                    <div className="text-sm font-semibold">{t('qualityConflict')}</div>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                        {t('qualityConflictBody', { label: strengthConflict.conflictLabel })}
                                    </p>
                                    <div className="mt-3 flex justify-end gap-2">
                                        <Button variant="ghost" size="sm" onClick={() => setStrengthConflict(null)}>
                                            {t('cancel')}
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
                                            {t('moveAnyway')}
                                        </Button>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setStrengthConflict(null)}
                                    aria-label={t('dismiss')}
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
                            culture="en-US"
                            events={events}
                            startAccessor={eventStartAccessor}
                            endAccessor={eventEndAccessor}
                            onSelectEvent={handleSelectEvent}
                            onSelectSlot={(slot: { start: Date }) => {
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
            )}

            {/* Workout Dialog.
                On a demo-tour stop these cards open non-modally: a modal Radix dialog
                dims and click-blocks everything outside it, which on mobile means the
                pinned tour bar (its guide text and Back/Next) is unusable. Non-modal
                drops the overlay entirely, so the card floats over the agenda and the
                tour stays readable and operable. */}
            <Dialog open={isWorkoutDialogOpen} onOpenChange={setIsWorkoutDialogOpen} modal={!tourOpen}>
                {/* max-h + scroll: in mobile landscape the card is taller than the viewport,
                    and without this the header controls and footer buttons are unreachable. */}
                <DialogContent className={cn('sm:max-w-2xl overflow-y-auto', tourDialogClass)}>
                    <DialogTitle className="sr-only">{t('workoutDetails')}</DialogTitle>
                    <DialogDescription className="sr-only">{t('workoutDetailsDescription')}</DialogDescription>
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
                                if (!response.ok) throw new Error(result.error || t('sendFailedShort'))
                                queryClient.invalidateQueries({ queryKey: ['workouts'] })
                                toast.success(t('sentToGarmin'))
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
                <DialogContent className="sm:max-w-2xl max-h-[90dvh] overflow-y-auto">
                    <DialogTitle className="sr-only">{t('createWorkout')}</DialogTitle>
                    <DialogDescription className="sr-only">{t('createWorkoutDescription')}</DialogDescription>
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
            <Dialog open={isStrengthDialogOpen} onOpenChange={setIsStrengthDialogOpen} modal={!tourOpen}>
                <DialogContent className={cn('sm:max-w-2xl flex flex-col overflow-hidden', tourDialogClass)}>
                    <DialogTitle className="sr-only">{t('strengthSessionDetails')}</DialogTitle>
                    <DialogDescription className="sr-only">{t('strengthSessionDetailsDescription')}</DialogDescription>
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
            <Dialog open={isActivityDialogOpen} onOpenChange={setIsActivityDialogOpen} modal={!tourOpen}>
                <DialogContent className={cn('sm:max-w-[595px] overflow-y-auto', tourDialogClass)}>
                    <DialogTitle className="sr-only">{t('activityDetails')}</DialogTitle>
                    <DialogDescription className="sr-only">{t('activityDetailsDescription')}</DialogDescription>
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
                                    {t('viewFullDetails')}
                                </Button>
                            </div>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    )
}
