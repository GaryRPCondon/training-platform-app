'use client'

import { useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { toast } from 'sonner'

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

import { ParsedProgram } from '@/lib/strength/schemas'

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

const QUALITY_TYPES = new Set(['intervals', 'tempo', 'long_run', 'race'])

export function StepSchedule({
  program, submitting, onBack, onConfirm,
}: {
  program: ParsedProgram
  submitting: boolean
  onBack: () => void
  onConfirm: (startDate: string, cadenceDays: number, placements: Placement[]) => void
}) {
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [cadenceDays, setCadenceDays] = useState(2)
  const [generating, setGenerating] = useState(false)
  const [placements, setPlacements] = useState<Placement[]>([])
  const [workouts, setWorkouts] = useState<PlannedWorkoutSummary[]>([])

  async function generateSchedule() {
    setGenerating(true)
    try {
      const res = await fetch('/api/strength/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parsedProgram: program, startDate, cadenceDays }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to generate schedule')
      setPlacements(data.placements ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Schedule generation failed')
    } finally {
      setGenerating(false)
    }
  }

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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Schedule sessions</CardTitle>
        <CardDescription>
          Pick a start date and cadence. The AI will distribute sessions around your running plan,
          avoiding quality and long-run days. You can adjust individual dates before importing.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="start-date" className="mb-1.5 block">Start date</Label>
            <Input
              id="start-date"
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="cadence" className="mb-1.5 block">Cadence</Label>
            <Select value={String(cadenceDays)} onValueChange={v => setCadenceDays(Number(v))}>
              <SelectTrigger id="cadence">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Every day</SelectItem>
                <SelectItem value="2">Every 2 days</SelectItem>
                <SelectItem value="3">Every 3 days</SelectItem>
                <SelectItem value="4">Every 4 days</SelectItem>
                <SelectItem value="5">Every 5 days</SelectItem>
                <SelectItem value="7">Once a week</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <Button onClick={generateSchedule} disabled={generating}>
            {generating ? 'Generating...' : placements.length === 0 ? 'Generate schedule' : 'Regenerate'}
          </Button>
        </div>

        {placements.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {placements.length} session{placements.length === 1 ? '' : 's'} scheduled.
              Edit a date below to override the AI&apos;s choice.
            </p>
            {placements.map(placement => {
              const session = program.sessions.find(s => s.session_index === placement.session_index)
              const conflict = workoutOn(placement.scheduled_date)
              const isQualityConflict = conflict && QUALITY_TYPES.has(conflict.workout_type)
              return (
                <div key={placement.session_index} className="rounded-md border p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          Session {placement.session_index}
                        </span>
                        <span className="font-medium">{session?.title ?? 'Untitled'}</span>
                      </div>
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
        <Button variant="outline" onClick={onBack}>Back</Button>
        <Button
          disabled={placements.length === 0 || submitting}
          onClick={() => onConfirm(startDate, cadenceDays, placements)}
        >
          {submitting ? 'Importing...' : 'Confirm and import'}
        </Button>
      </CardFooter>
    </Card>
  )
}
