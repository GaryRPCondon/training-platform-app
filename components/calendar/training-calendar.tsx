'use client'

import { useState, useCallback } from 'react'
import { Calendar, momentLocalizer, View } from 'react-big-calendar'
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop'
import moment from 'moment'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getPlannedWorkoutsForDateRange, getAthleteProfile } from '@/lib/supabase/queries'
import { startOfWeek, endOfWeek, format, startOfMonth, endOfMonth, subDays, addDays } from 'date-fns'
import { Card } from '@/components/ui/card'
import { WorkoutDetail } from '@/components/workouts/workout-detail'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { getWorkoutColor } from '@/lib/constants/workout-colors'
import { WeeklyTotals } from './weekly-totals'
import { CustomToolbar } from './custom-toolbar'

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
`

const localizer = momentLocalizer(moment)
const DnDCalendar = withDragAndDrop(Calendar)

function formatWorkoutTitle(workout: any): string {
    const description = workout.description || 'Workout'

    if (workout.distance_target_meters) {
        const km = (workout.distance_target_meters / 1000).toFixed(1)
        return `${description} ${km}km`
    }

    if (workout.duration_target_seconds) {
        const mins = Math.round(workout.duration_target_seconds / 60)
        return `${description} ${mins}min`
    }

    return description
}

export function TrainingCalendar() {
    const [currentDate, setCurrentDate] = useState(new Date())
    const [view, setView] = useState<View>('month')
    const [selectedWorkout, setSelectedWorkout] = useState<any>(null)
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const queryClient = useQueryClient()

    // Get athlete profile for week start preference
    const { data: athlete } = useQuery({
        queryKey: ['athlete'],
        queryFn: getAthleteProfile,
    })

    const weekStartsOn = (athlete?.week_starts_on ?? 0) as 0 | 1 | 2 | 3 | 4 | 5 | 6 // Default to Sunday if not set

    // Update moment locale to use the preferred week start day
    moment.updateLocale('en', {
        week: {
            dow: weekStartsOn, // 0 = Sunday, 1 = Monday, etc.
        }
    })

    const queryStart = view === 'month'
        ? format(subDays(startOfMonth(currentDate), 7), 'yyyy-MM-dd')
        : format(startOfWeek(currentDate, { weekStartsOn: weekStartsOn as 0 | 1 | 2 | 3 | 4 | 5 | 6 }), 'yyyy-MM-dd')

    const queryEnd = view === 'month'
        ? format(addDays(endOfMonth(currentDate), 7), 'yyyy-MM-dd')
        : format(endOfWeek(currentDate, { weekStartsOn: weekStartsOn as 0 | 1 | 2 | 3 | 4 | 5 | 6 }), 'yyyy-MM-dd')

    const { data: workouts, isLoading } = useQuery({
        queryKey: ['workouts', queryStart, queryEnd],
        queryFn: () => getPlannedWorkoutsForDateRange(queryStart, queryEnd),
    })

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

    const events = workouts?.map(w => ({
        id: w.id,
        title: formatWorkoutTitle(w),
        start: new Date(w.scheduled_date),
        end: new Date(w.scheduled_date),
        allDay: true,
        resource: w,
    })) || []

    const handleSelectEvent = (event: any) => {
        setSelectedWorkout(event.resource)
        setIsDialogOpen(true)
    }

    const onEventDrop = useCallback(({ event, start }: any) => {
        const newDate = format(start, 'yyyy-MM-dd')
        if (newDate !== event.resource.scheduled_date) {
            rescheduleMutation.mutate({
                workoutId: event.id,
                newDate
            })
        }
    }, [rescheduleMutation])

    const eventStyleGetter = (event: any) => {
        const workout = event.resource
        const workoutType = workout?.workout_type || 'default'
        const backgroundColor = getWorkoutColor(workoutType)

        return {
            style: {
                backgroundColor,
                borderRadius: '4px',
                opacity: 0.9,
                color: 'white',
                border: '0px',
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
            if (view === 'month') newDate.setMonth(newDate.getMonth() - 1)
            else if (view === 'week') newDate.setDate(newDate.getDate() - 7)
            else newDate.setDate(newDate.getDate() - 1)
            setCurrentDate(newDate)
        } else if (action === 'NEXT') {
            if (view === 'month') newDate.setMonth(newDate.getMonth() + 1)
            else if (view === 'week') newDate.setDate(newDate.getDate() + 7)
            else newDate.setDate(newDate.getDate() + 1)
            setCurrentDate(newDate)
        }
    }

    return (
        <div className="h-full w-full flex flex-col overflow-hidden">
            <CustomToolbar
                date={currentDate}
                view={view as 'month' | 'week' | 'day'}
                onNavigate={handleNavigate}
                onViewChange={(v) => setView(v)}
            />

            <div className="flex-1 w-full grid grid-cols-[1fr_220px] overflow-hidden border rounded-md">
                <div className="h-full w-full bg-background overflow-hidden relative min-w-0 border-r">
                    <style>{calendarStyles}</style>
                    <DnDCalendar
                        localizer={localizer}
                        events={events}
                        startAccessor={(event: any) => event.start}
                        endAccessor={(event: any) => event.end}
                        onSelectEvent={handleSelectEvent}
                        date={currentDate}
                        onNavigate={setCurrentDate}
                        view={view}
                        onView={setView}
                        views={['month', 'week', 'day']}
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
                    currentDate={currentDate}
                    view={view as 'month' | 'week' | 'day'}
                    weekStartsOn={weekStartsOn}
                    showActual={true}
                />
            </div>

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {selectedWorkout?.workout_type?.replace(/_/g, ' ').toUpperCase() || 'Workout Details'}
                        </DialogTitle>
                    </DialogHeader>
                    {selectedWorkout && (
                        <WorkoutDetail workout={selectedWorkout} />
                    )}
                </DialogContent>
            </Dialog>
        </div>
    )
}
