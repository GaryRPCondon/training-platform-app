'use client'

import { useState, useCallback } from 'react'
import { Calendar, momentLocalizer, View } from 'react-big-calendar'
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop'
import moment from 'moment'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getPlannedWorkoutsForDateRange } from '@/lib/supabase/queries'
import { startOfWeek, endOfWeek, format, startOfMonth, endOfMonth, subDays, addDays } from 'date-fns'
import { Card } from '@/components/ui/card'
import { WorkoutDetail } from '@/components/workouts/workout-detail'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { toast } from 'sonner'

const localizer = momentLocalizer(moment)
const DnDCalendar = withDragAndDrop(Calendar)

export function TrainingCalendar() {
    const [currentDate, setCurrentDate] = useState(new Date())
    const [view, setView] = useState<View>('month')
    const [selectedWorkout, setSelectedWorkout] = useState<any>(null)
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const queryClient = useQueryClient()

    const queryStart = view === 'month'
        ? format(subDays(startOfMonth(currentDate), 7), 'yyyy-MM-dd')
        : format(startOfWeek(currentDate), 'yyyy-MM-dd')

    const queryEnd = view === 'month'
        ? format(addDays(endOfMonth(currentDate), 7), 'yyyy-MM-dd')
        : format(endOfWeek(currentDate), 'yyyy-MM-dd')

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
        title: w.workout_type.replace('_', ' ').toUpperCase(),
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

    return (
        <div className="h-[600px] bg-background">
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
                style={{ height: '100%' }}
                onEventDrop={onEventDrop}
                draggableAccessor={() => true}
                resizable={false}
            />

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent>
                    {selectedWorkout && (
                        <WorkoutDetail workout={selectedWorkout} />
                    )}
                </DialogContent>
            </Dialog>
        </div>
    )
}
