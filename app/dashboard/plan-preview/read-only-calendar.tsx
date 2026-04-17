'use client'

import { useMemo, useState, useEffect } from 'react'
import { Calendar, momentLocalizer, View } from 'react-big-calendar'
import moment from 'moment'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import { parseISO } from 'date-fns'
import { getWorkoutColor } from '@/lib/constants/workout-colors'
import type { CalEvent, PlanWorkout } from './types'

const localizer = momentLocalizer(moment)

const styles = `
  .preview-cal .rbc-event { padding: 1px 4px !important; font-size: 11px !important; line-height: 1.3 !important; }
  .preview-cal .rbc-month-view, .preview-cal .rbc-month-row, .preview-cal .rbc-row-content { overflow: visible !important; }
`

export function ReadOnlyCalendar({
  events,
  startDate,
  onSelectWorkout,
}: {
  events: CalEvent[]
  startDate: string
  onSelectWorkout: (w: PlanWorkout) => void
}) {
  const [date, setDate] = useState<Date>(() => parseISO(startDate))
  const [view, setView] = useState<View>('month')

  // Reset to plan start when a new plan is loaded
  useEffect(() => {
    setDate(parseISO(startDate))
  }, [startDate])

  const eventPropGetter = useMemo(
    () => (event: CalEvent) => ({
      style: {
        backgroundColor: getWorkoutColor(event.type),
        borderColor: getWorkoutColor(event.type),
        color: '#fff',
        border: 'none',
      },
    }),
    [],
  )

  return (
    <>
      <style>{styles}</style>
      <div className="preview-cal h-full w-full">
        <Calendar<CalEvent>
          localizer={localizer}
          events={events}
          startAccessor="start"
          endAccessor="end"
          views={['month']}
          view={view}
          onView={setView}
          date={date}
          onNavigate={setDate}
          style={{ height: '100%', width: '100%' }}
          eventPropGetter={eventPropGetter}
          onSelectEvent={(e) => onSelectWorkout(e.workout)}
          popup
        />
      </div>
    </>
  )
}
