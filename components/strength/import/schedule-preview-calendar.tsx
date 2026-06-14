/**
 * Schedule Preview Calendar
 *
 * A read-only month calendar used in the import wizard's schedule step.
 * Overlays proposed strength placements on top of the athlete's existing run
 * workouts so the user can see where strength sessions will land relative to
 * their training week before committing.
 *
 * Deliberately separate from `components/calendar/training-calendar.tsx` to
 * avoid threading a `previewMode` through all the interactive code paths
 * (drag, slot select, dialogs, mutations) on the main calendar.
 */
'use client'

import { useEffect, useMemo, useState } from 'react'
import { Calendar, type Event } from 'react-big-calendar'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import { format, parseISO, startOfMonth, endOfMonth, subDays, addDays } from 'date-fns'
import { Dumbbell } from 'lucide-react'
import { createCalendarLocalizer } from '@/lib/utils/calendar-localizer'

const localizer = createCalendarLocalizer(0)

interface Placement {
  session_index: number
  scheduled_date: string
}

interface PreviewRunWorkout {
  scheduled_date: string
  workout_type: string
  description: string | null
}

interface ScheduleEvent extends Event {
  kind: 'strength' | 'run'
  scheduledDate: string
  sessionIndex?: number
  workoutType?: string
}

export function SchedulePreviewCalendar({
  startDate,
  placements,
  placementLabel,
  onPlacementClick,
}: {
  startDate: string
  placements: Placement[]
  /** Returns the display label for a placement (e.g. "Week 1 / Core"). */
  placementLabel: (p: Placement) => string
  /** Fires when the user clicks one of the strength events. */
  onPlacementClick?: (sessionIndex: number) => void
}) {
  const initial = useMemo(() => parseISO(startDate), [startDate])
  const [currentDate, setCurrentDate] = useState<Date>(initial)
  useEffect(() => { setCurrentDate(initial) }, [initial])

  const queryStart = useMemo(() => format(subDays(startOfMonth(currentDate), 7), 'yyyy-MM-dd'), [currentDate])
  const queryEnd = useMemo(() => format(addDays(endOfMonth(currentDate), 7), 'yyyy-MM-dd'), [currentDate])

  const [runs, setRuns] = useState<PreviewRunWorkout[]>([])
  useEffect(() => {
    fetch(`/api/workouts?startDate=${queryStart}&endDate=${queryEnd}`)
      .then(res => res.ok ? res.json() : [])
      .then((data: unknown) => {
        setRuns(Array.isArray(data) ? (data as PreviewRunWorkout[]) : [])
      })
      .catch(() => setRuns([]))
  }, [queryStart, queryEnd])

  const events = useMemo<ScheduleEvent[]>(() => {
    const out: ScheduleEvent[] = []
    for (const r of runs) {
      out.push({
        kind: 'run',
        scheduledDate: r.scheduled_date,
        workoutType: r.workout_type,
        title: r.description ?? r.workout_type,
        start: parseISO(r.scheduled_date),
        end: parseISO(r.scheduled_date),
        allDay: true,
      })
    }
    for (const p of placements) {
      out.push({
        kind: 'strength',
        scheduledDate: p.scheduled_date,
        sessionIndex: p.session_index,
        title: `🏋 ${placementLabel(p)}`,
        start: parseISO(p.scheduled_date),
        end: parseISO(p.scheduled_date),
        allDay: true,
      })
    }
    return out
  }, [runs, placements, placementLabel])

  // Same colour set as the main calendar so the preview reads as the same UI.
  const runEventColor = (workoutType: string | undefined): string => {
    switch (workoutType) {
      case 'long_run': return 'rgb(59, 130, 246)'           // blue
      case 'tempo':
      case 'intervals':
      case 'race_pace':
      case 'race': return 'rgb(236, 72, 153)'               // pink
      case 'rest': return 'rgb(100, 116, 139)'              // slate
      case 'recovery': return 'rgb(168, 85, 247)'           // violet
      default: return 'rgb(16, 185, 129)'                   // emerald (easy etc.)
    }
  }

  return (
    <div className="h-[480px] w-full rounded-md border bg-background">
      <style>{`
        .preview-cal .rbc-event {
          padding: 1px 4px !important;
          font-size: 11px !important;
          line-height: 1.3 !important;
          border: none !important;
        }
        .preview-cal .rbc-event.strength {
          background-color: rgba(99, 102, 241, 0.85) !important;
          color: white !important;
          font-weight: 500;
          cursor: pointer;
        }
        .preview-cal .rbc-event.run {
          color: white !important;
        }
        .preview-cal .rbc-month-view {
          border: none !important;
        }
      `}</style>
      <div className="preview-cal h-full w-full">
        <Calendar
          localizer={localizer}
          culture="en-US"
          events={events}
          date={currentDate}
          onNavigate={setCurrentDate}
          view="month"
          views={['month']}
          toolbar={true}
          selectable={false}
          popup
          style={{ height: '100%', width: '100%' }}
          eventPropGetter={(event) => {
            const e = event as ScheduleEvent
            if (e.kind === 'strength') {
              return { className: 'strength' }
            }
            return {
              className: 'run',
              style: { backgroundColor: runEventColor(e.workoutType) },
            }
          }}
          onSelectEvent={(event) => {
            const e = event as ScheduleEvent
            if (e.kind === 'strength' && e.sessionIndex != null) {
              onPlacementClick?.(e.sessionIndex)
            }
          }}
          components={{
            event: ({ event }) => {
              const e = event as ScheduleEvent
              if (e.kind === 'strength') {
                return (
                  <span className="inline-flex items-center gap-1">
                    <Dumbbell className="h-3 w-3" />
                    <span>{(e.title as string).replace(/^🏋\s/, '')}</span>
                  </span>
                )
              }
              return <span>{e.title as string}</span>
            },
          }}
        />
      </div>
    </div>
  )
}
