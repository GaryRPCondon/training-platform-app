'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'

import { scrollBehavior } from '@/lib/utils/motion'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

import { ParsedProgram } from '@/lib/strength/schemas'
import type { ProgramType } from './step-input'
import { SchedulePreviewCalendar } from './schedule-preview-calendar'

interface Placement {
  session_index: number
  scheduled_date: string
  placement_rationale: string
}

interface PlannedWorkoutSummary {
  scheduled_date: string
  workout_type: string
  description: string | null
}

const QUALITY_TYPES = new Set(['intervals', 'tempo', 'long_run', 'race', 'race_pace'])

export function StepSchedule({
  program, programType, startDate, weeksToRepeat, submitting, onBack, onConfirm,
}: {
  program: ParsedProgram
  programType: ProgramType
  startDate: string
  weeksToRepeat: number
  submitting: boolean
  onBack: () => void
  onConfirm: (placements: Placement[]) => void
}) {
  const t = useTranslations('strengthImport')
  const [generating, setGenerating] = useState(false)
  const [placements, setPlacements] = useState<Placement[]>([])
  const [workouts, setWorkouts] = useState<PlannedWorkoutSummary[]>([])

  const templateLen = program.sessions.length

  const generateSchedule = useCallback(async () => {
    setGenerating(true)
    try {
      const body: Record<string, unknown> = {
        parsedProgram: program,
        startDate,
        programType,
      }
      if (programType === 'weekly') body.weeksToRepeat = weeksToRepeat

      const res = await fetch('/api/strength/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? t('scheduleError'))
      setPlacements(data.placements ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('scheduleFailed'))
    } finally {
      setGenerating(false)
    }
  // startDate / programType / weeksToRepeat / program are stable for the life of
  // this step (set on step 1), so an empty dep list keeps the callback identity
  // stable for the auto-run effect below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-generate placement on entry so the user doesn't have to click a second
  // "Generate schedule" button after already confirming the review. The ref
  // guard stops React's dev-mode double-invoke from firing two requests.
  const didAutoGenerate = useRef(false)
  useEffect(() => {
    if (didAutoGenerate.current) return
    didAutoGenerate.current = true
    generateSchedule()
  }, [generateSchedule])

  // Load planned workouts in the schedule window so we can show conflicts.
  useEffect(() => {
    if (placements.length === 0) return
    const dates = placements.map(p => p.scheduled_date).sort()
    const start = dates[0]
    const end = dates[dates.length - 1]
    fetch(`/api/workouts?startDate=${start}&endDate=${end}`)
      .then(res => res.ok ? res.json() : [])
      .then((data: PlannedWorkoutSummary[] | { error?: string }) => {
        setWorkouts(Array.isArray(data) ? data : [])
      })
      .catch(() => setWorkouts([]))
  }, [placements])

  function updatePlacementDate(sessionIndex: number, newDate: string) {
    setPlacements(prev => prev.map(p =>
      p.session_index === sessionIndex ? { ...p, scheduled_date: newDate } : p,
    ))
  }

  function workoutOn(date: string): PlannedWorkoutSummary | undefined {
    return workouts.find(w => w.scheduled_date === date)
  }

  // For weekly programs, sessions are placed in groups: session_index 1..N is
  // week 1, N+1..2N is week 2, etc. Map expanded index → template session.
  function templateSessionFor(sessionIndex: number) {
    const templateIdx = (sessionIndex - 1) % templateLen
    return program.sessions[templateIdx]
  }

  // Refs per placement row so a click on the preview calendar can scroll the
  // corresponding row into view and flash it.
  const rowRefs = useRef(new Map<number, HTMLDivElement | null>())
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null)
  const placementLabel = useCallback((p: { session_index: number }) => {
    const session = templateSessionFor(p.session_index)
    if (programType === 'weekly') {
      const week = Math.floor((p.session_index - 1) / templateLen) + 1
      return t('weekPrefix', { week, title: session?.title ?? t('untitled') })
    }
    return session?.title ?? t('sessionIndexLabel', { index: p.session_index })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programType, templateLen, program.sessions])

  const handlePlacementClick = useCallback((sessionIndex: number) => {
    const node = rowRefs.current.get(sessionIndex)
    if (node) {
      node.scrollIntoView({ behavior: scrollBehavior(), block: 'center' })
      setHighlightedIndex(sessionIndex)
      window.setTimeout(() => setHighlightedIndex(prev => prev === sessionIndex ? null : prev), 1500)
    }
  }, [])

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('previewTitle')}</CardTitle>
        <CardDescription>
          {programType === 'weekly'
            ? t('descWeekly', {
                date: format(parseISO(startDate), 'EEE, MMM d'),
                sessions: templateLen,
                weeks: weeksToRepeat,
                total: templateLen * weeksToRepeat,
              })
            : t('descFixed', { date: format(parseISO(startDate), 'EEE, MMM d') })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={generateSchedule} disabled={generating}>
            {generating ? t('generating') : t('regenerate')}
          </Button>
          {generating && placements.length === 0 && (
            <span className="text-sm text-muted-foreground">{t('placingSessions')}</span>
          )}
        </div>

        {placements.length > 0 && (
          <>
            <SchedulePreviewCalendar
              startDate={startDate}
              placements={placements}
              placementLabel={placementLabel}
              onPlacementClick={handlePlacementClick}
            />
          </>
        )}

        {placements.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t('sessionsScheduled', { count: placements.length })}
            </p>
            {placements.map(placement => {
              const session = templateSessionFor(placement.session_index)
              const conflict = workoutOn(placement.scheduled_date)
              const isQualityConflict = conflict && QUALITY_TYPES.has(conflict.workout_type)
              const weekNumber = programType === 'weekly'
                ? Math.floor((placement.session_index - 1) / templateLen) + 1
                : null
              const isHighlighted = highlightedIndex === placement.session_index
              return (
                <div
                  key={placement.session_index}
                  ref={(el) => { rowRefs.current.set(placement.session_index, el) }}
                  className={`rounded-md border p-3 transition-colors ${isHighlighted ? 'bg-accent ring-2 ring-primary' : ''}`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {weekNumber != null
                            ? t('weekLabel', { week: weekNumber })
                            : t('sessionIndexLabel', { index: placement.session_index })}
                        </span>
                        <span className="font-medium">{session?.title ?? t('untitled')}</span>
                      </div>
                      {session && session.exercises.length > 0 && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {session.exercises.slice(0, 4).map(e => e.display_name).join(' · ')}
                          {session.exercises.length > 4 && ` ${t('moreCount', { count: session.exercises.length - 4 })}`}
                        </p>
                      )}
                      <p className="mt-1 text-sm italic text-muted-foreground">
                        {placement.placement_rationale}
                      </p>
                      {conflict && (
                        <div className="mt-2 flex items-center gap-2 text-xs">
                          <Badge variant={isQualityConflict ? 'destructive' : 'secondary'}>
                            {conflict.workout_type}
                          </Badge>
                          {conflict.description && (
                            <span className="text-muted-foreground">{conflict.description}</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="sm:w-44">
                      <Input
                        type="date"
                        value={placement.scheduled_date}
                        onChange={e => updatePlacementDate(placement.session_index, e.target.value)}
                      />
                      <p className="mt-1 text-xs text-muted-foreground">
                        {format(parseISO(placement.scheduled_date), 'EEE, MMM d')}
                      </p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
      <CardFooter className="flex justify-between gap-2">
        <Button variant="outline" onClick={onBack}>{t('back')}</Button>
        <Button
          disabled={placements.length === 0 || submitting}
          onClick={() => onConfirm(placements)}
        >
          {submitting ? t('importing') : t('importToCalendar')}
        </Button>
      </CardFooter>
    </Card>
  )
}
