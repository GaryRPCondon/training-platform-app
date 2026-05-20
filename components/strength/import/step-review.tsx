'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertCircle, Check, X, Code2 } from 'lucide-react'
import { ParsedProgram, parsedProgramSchema, Exercise } from '@/lib/strength/schemas'

interface ParseResult {
  program: ParsedProgram
  confidence: number
  contentType: 'strength' | 'mobility' | 'mixed' | 'other'
  warnings: string[]
}

const CONFIDENCE_THRESHOLD = 0.7

export function StepReview({
  result, onBack, onStartOver, onConfirm,
}: {
  result: ParseResult
  onBack: () => void
  onStartOver: () => void
  onConfirm: (program: ParsedProgram) => void
}) {
  const [editingJson, setEditingJson] = useState(false)
  const [jsonText, setJsonText] = useState(() => JSON.stringify(result.program, null, 2))
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [editedProgram, setEditedProgram] = useState<ParsedProgram>(result.program)

  function applyJson() {
    try {
      const parsed = JSON.parse(jsonText)
      const validated = parsedProgramSchema.safeParse(parsed)
      if (!validated.success) {
        setJsonError(JSON.stringify(validated.error.flatten(), null, 2))
        return
      }
      setEditedProgram(validated.data)
      setJsonError(null)
      setEditingJson(false)
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : 'Invalid JSON')
    }
  }

  const isLowConfidence = result.confidence < CONFIDENCE_THRESHOLD || result.contentType === 'other'

  return (
    <Card>
      <CardHeader>
        <CardTitle>{editedProgram.name}</CardTitle>
        <CardDescription>
          {editedProgram.sessions.length} session{editedProgram.sessions.length === 1 ? '' : 's'} ·
          {' '}content type: {editedProgram.content_type} ·
          {' '}parse confidence: {(result.confidence * 100).toFixed(0)}%
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLowConfidence && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-1">
                <p className="font-medium">
                  {result.contentType === 'other'
                    ? 'This does not look like a strength or mobility plan.'
                    : 'Low parsing confidence.'}
                </p>
                {result.warnings.length > 0 && (
                  <ul className="list-disc pl-5 text-sm">
                    {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                )}
                <p className="text-sm">Review carefully before importing, or go back and adjust your input.</p>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {!isLowConfidence && result.warnings.length > 0 && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <ul className="list-disc pl-5 text-sm">
                {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => setEditingJson(v => !v)}>
            <Code2 className="mr-2 h-4 w-4" />
            {editingJson ? 'Close JSON editor' : 'Edit JSON'}
          </Button>
        </div>

        {editingJson && (
          <div className="space-y-2">
            <Textarea
              value={jsonText}
              onChange={e => setJsonText(e.target.value)}
              rows={20}
              className="font-mono text-xs"
            />
            {jsonError && (
              <pre className="rounded bg-destructive/10 p-2 text-xs text-destructive whitespace-pre-wrap">{jsonError}</pre>
            )}
            <Button size="sm" onClick={applyJson}>Validate and apply</Button>
          </div>
        )}

        <div className="space-y-4">
          {editedProgram.sessions.map(session => (
            <div key={session.session_index} className="rounded-md border p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Session {session.session_index}</span>
                <span className="font-medium">{session.title}</span>
                {session.estimated_duration_minutes && (
                  <Badge variant="secondary">{session.estimated_duration_minutes} min</Badge>
                )}
              </div>
              {session.coaching_note && (
                <p className="mb-2 text-sm italic text-muted-foreground">{session.coaching_note}</p>
              )}
              <ul className="space-y-1.5">
                {session.exercises.map((ex, i) => (
                  <ExerciseLine key={i} exercise={ex} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      </CardContent>
      <CardFooter className="flex justify-between gap-2">
        <div className="flex gap-2">
          <Button variant="outline" onClick={onBack}>Back</Button>
          <Button variant="ghost" onClick={onStartOver}>Start over</Button>
        </div>
        <Button onClick={() => onConfirm(editedProgram)}>Looks good — schedule it</Button>
      </CardFooter>
    </Card>
  )
}

function ExerciseLine({ exercise }: { exercise: Exercise }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <span className="mt-0.5">
        {exercise.garmin_supported
          ? <Check className="h-4 w-4 text-green-600" aria-label="Supported by Garmin" />
          : <X className="h-4 w-4 text-muted-foreground" aria-label="Not supported by Garmin" />}
      </span>
      <span className="flex-1">
        <span className="font-medium">{exercise.display_name}</span>
        {' — '}
        <span className="text-muted-foreground">{describeMeasurement(exercise)}</span>
        {exercise.notes && (
          <span className="ml-2 text-xs italic text-muted-foreground">({exercise.notes})</span>
        )}
      </span>
    </li>
  )
}

function describeMeasurement(ex: Exercise): string {
  const m = ex.measurement
  const setPart = m.sets > 1 ? `${m.sets} sets × ` : ''
  let detail = ''
  if (m.type === 'reps') detail = `${m.reps_per_set} reps`
  else if (m.type === 'duration') detail = formatDuration(m.duration_seconds ?? 0)
  else if (m.type === 'distance') detail = `${m.distance_meters}m`
  const weight = m.weight_kg ? ` @ ${m.weight_kg}kg` : ''
  const rest = m.rest_seconds ? `, ${m.rest_seconds}s rest` : ''
  return `${setPart}${detail}${weight}${rest}`
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return secs === 0 ? `${mins} min` : `${mins}m ${secs}s`
}
