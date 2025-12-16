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
  const [view, setView] = useState<View>('month')
  const [currentDate, setCurrentDate] = useState(new Date())

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
          date={currentDate}
          onNavigate={setCurrentDate}
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
  // Use the description field which has proper names like "Easy aerobic run" or "Marathon Race Day"
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
