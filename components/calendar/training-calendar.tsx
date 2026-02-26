'use client'

import { useState, useCallback, useMemo } from 'react'
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
import { toast } from 'sonner'
import { getWorkoutColor, normalizeActivityType } from '@/lib/constants/workout-colors'
import { toDisplayDistance, distanceLabel, type UnitSystem } from '@/lib/utils/units'
import { WeeklyTotals } from './weekly-totals'
import { CustomToolbar } from './custom-toolbar'
import { createClient } from '@/lib/supabase/client'
import type { TrainingPaces } from '@/types/database'
import type { WorkoutWithDetails } from '@/types/review'
import { useRouter } from 'next/navigation'

// Custom styles to enable text wrapping in calendar events (max 2 lines)
const calendarStyles = `
  .rbc-event {
    display: -webkit-box !important;
    -webkit-line-clamp: 2 !important;
    -webkit-box-orient: vertical !important;
    overflow: hidden !important;
    line-height: 1.3 !important;
    white-space: normal !important;
  }
  .rbc-event-content {
    display: -webkit-box !important;
    -webkit-line-clamp: 2 !important;
    -webkit-box-orient: vertical !important;
    overflow: hidden !important;
    white-space: normal !important;
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
  }
`

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

export function TrainingCalendar() {
    const [currentDate, setCurrentDate] = useState(new Date())
    const [selectedWorkout, setSelectedWorkout] = useState<WorkoutWithDetails | null>(null)
    const [selectedActivity, setSelectedActivity] = useState<any | null>(null)
    const [isWorkoutDialogOpen, setIsWorkoutDialogOpen] = useState(false)
    const [isActivityDialogOpen, setIsActivityDialogOpen] = useState(false)
    const [isAutoMatching, setIsAutoMatching] = useState(false)
    const [createDate, setCreateDate] = useState<Date | null>(null)
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
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

    // Convert raw workouts to WorkoutWithDetails format
    const workouts: WorkoutWithDetails[] = useMemo(() => {
        if (!rawWorkouts) return []

        return rawWorkouts.map(workout => ({
            ...workout,
            date: parseISO(workout.scheduled_date),
            formatted_date: format(parseISO(workout.scheduled_date), 'EEE, MMM d'),
            phase_name: 'Active Plan', // Not critical for dashboard view
            week_of_plan: 0 // Not used in dashboard view
        }))
    }, [rawWorkouts])

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
        const workoutEvents = workouts.map(w => ({
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
    }, [workouts, rawActivities, preferredUnits])

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
                    padding: '2px 4px',
                    whiteSpace: 'normal',
                    overflow: 'visible',
                    lineHeight: '1.2'
                }
            }
        }

        // Workout styling (existing)
        const workout = event.resource.data
        const workoutType = workout?.workout_type || 'default'
        const backgroundColor = getWorkoutColor(workoutType)
        let borderLeft = ''
        let opacity = 0.9

        // Visual feedback for completion status
        if (workout.completion_status === 'completed') {
            borderLeft = '4px solid #10b981' // green-500
            opacity = 1.0
        } else if (workout.completion_status === 'partial') {
            borderLeft = '4px solid #f59e0b' // yellow-500
            opacity = 0.95
        } else if (workout.completion_status === 'skipped') {
            borderLeft = '4px solid #ef4444' // red-500
            opacity = 0.6
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
                whiteSpace: 'normal',
                overflow: 'visible',
                lineHeight: '1.2'
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

    const handleSendWeekToGarmin = useCallback(async (weekStart: Date, weekEnd: Date) => {
        const weekWorkoutIds = (workouts || [])
            .filter(w => {
                const d = new Date(w.scheduled_date)
                return d >= weekStart && d <= weekEnd && w.workout_type !== 'rest'
            })
            .map(w => w.id)

        if (weekWorkoutIds.length === 0) {
            toast.error('No workouts to send this week')
            return
        }

        try {
            const response = await fetch('/api/garmin/workouts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workoutIds: weekWorkoutIds, action: 'send' }),
            })
            const result = await response.json()
            if (!response.ok) throw new Error(result.error || 'Failed to send')
            queryClient.invalidateQueries({ queryKey: ['workouts'] })
            toast.success(`Sent ${result.sent} workout${result.sent !== 1 ? 's' : ''} to Garmin`)
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Failed to send to Garmin')
        }
    }, [workouts, queryClient])

    const handleRemoveWeekFromGarmin = useCallback(async (weekStart: Date, weekEnd: Date) => {
        const weekWorkoutIds = (workouts || [])
            .filter(w => {
                const d = new Date(w.scheduled_date)
                return d >= weekStart && d <= weekEnd && w.garmin_workout_id
            })
            .map(w => w.id)

        if (weekWorkoutIds.length === 0) {
            toast.error('No synced workouts to remove this week')
            return
        }

        try {
            const response = await fetch('/api/garmin/workouts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workoutIds: weekWorkoutIds, action: 'delete' }),
            })
            const result = await response.json()
            if (!response.ok) throw new Error(result.error || 'Failed to remove')
            queryClient.invalidateQueries({ queryKey: ['workouts'] })
            toast.success(`Removed ${result.deleted} workout${result.deleted !== 1 ? 's' : ''} from Garmin`)
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Failed to remove from Garmin')
        }
    }, [workouts, queryClient])

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
            />

            <div className="flex-1 w-full flex flex-col landscape:grid landscape:grid-cols-[1fr_220px] md:grid md:grid-cols-[1fr_220px] overflow-visible landscape:overflow-hidden md:overflow-hidden border rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-black/5 dark:ring-white/10 dark:shadow-[0_8px_30px_rgb(0,0,0,0.2)]">
                <div className="h-[550px] landscape:h-full md:h-full w-full bg-background overflow-hidden relative min-w-0 border-b landscape:border-b-0 landscape:border-r md:border-b-0 md:border-r">
                    <style>{calendarStyles}</style>
                    <DnDCalendar
                        localizer={localizer}
                        events={events}
                        startAccessor={(event: any) => event.start}
                        endAccessor={(event: any) => event.end}
                        onSelectEvent={handleSelectEvent}
                        onSelectSlot={(slot: any) => {
                            setCreateDate(slot.start)
                            setIsCreateDialogOpen(true)
                        }}
                        selectable={true}
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
                    />
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

            {/* Activity Dialog */}
            <Dialog open={isActivityDialogOpen} onOpenChange={setIsActivityDialogOpen}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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
