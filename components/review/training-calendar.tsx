'use client'

import { useMemo, useState } from 'react'
import { Calendar, momentLocalizer, View } from 'react-big-calendar'
import moment from 'moment'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import type { WorkoutEvent, WorkoutWithDetails } from '@/types/review'
import type { TrainingPaces } from '@/types/database'
import { WorkoutCard } from './workout-card'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { getWorkoutColor } from '@/lib/constants/workout-colors'
import { WeeklyTotals } from '../calendar/weekly-totals'
import { useQuery } from '@tanstack/react-query'
import { getAthleteProfile } from '@/lib/supabase/queries'
import { CustomToolbar } from '../calendar/custom-toolbar'

// Custom styles to enable text wrapping and enforce alignment
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

interface TrainingCalendarProps {
  workouts: WorkoutWithDetails[]
  trainingPaces?: TrainingPaces | null
  vdot?: number | null
  onWorkoutSelect?: (workout: WorkoutWithDetails) => void
}

function formatWorkoutTitle(workout: WorkoutWithDetails): string {
  const description = workout.description || 'Workout'

  // Check if description already contains distance information (e.g., "10km", "15km", "5K")
  const hasDistanceInDescription = /\d+\.?\d*\s?(km|k|miles?|mi)\b/i.test(description)

  let title = description
  if (workout.distance_target_meters && !hasDistanceInDescription) {
    const km = (workout.distance_target_meters / 1000).toFixed(1)
    title = `${description} ${km}km`
  } else if (workout.duration_target_seconds) {
    const mins = Math.round(workout.duration_target_seconds / 60)
    title = `${description} ${mins}min`
  }

  // Add red flag if there's a validation warning
  if (workout.validation_warning) {
    title = `🚩 ${title}`
  }

  return title
}

export function TrainingCalendar({ workouts, trainingPaces, vdot, onWorkoutSelect }: TrainingCalendarProps) {
  const [selectedWorkout, setSelectedWorkout] = useState<WorkoutWithDetails | null>(null)
  const [view, setView] = useState<View>('month')
  const [currentDate, setCurrentDate] = useState(new Date())

  // Get athlete profile for week start preference
  const { data: athlete } = useQuery({
    queryKey: ['athlete'],
    queryFn: getAthleteProfile,
  })

  const weekStartsOn = (athlete?.week_starts_on ?? 1) as 0 | 1 | 2 | 3 | 4 | 5 | 6

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
    <>
      <div className="h-full w-full flex flex-col overflow-hidden">
        <CustomToolbar
          date={currentDate}
          view={view as 'month' | 'week' | 'day'}
          onNavigate={handleNavigate}
          onViewChange={(v) => setView(v)}
        />

        <div className="flex-1 w-full grid grid-cols-[1fr_220px] overflow-hidden border rounded-md">
          <div className="h-full min-w-0 border-r">
            <style>{calendarStyles}</style>
            <Calendar
              localizer={localizer}
              events={events}
              startAccessor="start"
              endAccessor="end"
              date={currentDate}
              onNavigate={setCurrentDate}
              view={view}
              onView={setView}
              views={['week', 'month']}
              onSelectEvent={handleSelectEvent}
              eventPropGetter={eventStyleGetter}
              style={{ height: '100%' }}
              toolbar={false}
            />
          </div>

          <WeeklyTotals
            workouts={workouts}
            currentDate={currentDate}
            view={view as 'month' | 'week' | 'day'}
            weekStartsOn={weekStartsOn}
            showActual={false}
          />
        </div>
      </div>

      <Dialog open={!!selectedWorkout} onOpenChange={() => setSelectedWorkout(null)}>
        <DialogContent className="max-w-2xl">
          <DialogTitle className="sr-only">Workout Details</DialogTitle>
          {selectedWorkout && (
            <WorkoutCard
              workout={selectedWorkout}
              trainingPaces={trainingPaces}
              vdot={vdot}
              onClose={() => setSelectedWorkout(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
