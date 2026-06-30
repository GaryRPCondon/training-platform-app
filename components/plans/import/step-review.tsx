'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertCircle, Code2, Loader2 } from 'lucide-react'
import { ParsedRunningPlan, parsedRunningPlanSchema, ImportedWorkout } from '@/lib/plans/import/schemas'
import { useEnumLabels } from '@/lib/i18n/enum-labels'
import { useTranslations } from 'next-intl'

export interface RunParseResult {
  plan: ParsedRunningPlan
  confidence: number
  contentType: 'running' | 'other'
  warnings: string[]
}

const CONFIDENCE_THRESHOLD = 0.7

export function StepReview({
  result, submitting, onBack, onStartOver, onConfirm,
}: {
  result: RunParseResult
  submitting: boolean
  onBack: () => void
  onStartOver: () => void
  onConfirm: (plan: ParsedRunningPlan) => void
}) {
  const t = useTranslations('planImport')
  const [editingJson, setEditingJson] = useState(false)
  const [jsonText, setJsonText] = useState(() => JSON.stringify(result.plan, null, 2))
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [editedPlan, setEditedPlan] = useState<ParsedRunningPlan>(result.plan)

  function applyJson() {
    let parsed: unknown
    try {
      parsed = JSON.parse(jsonText)
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : t('invalidJson'))
      return
    }
    const validated = parsedRunningPlanSchema.safeParse(parsed)
    if (!validated.success) {
      setJsonError(JSON.stringify(validated.error.flatten(), null, 2))
      return
    }
    setJsonError(null)
    setEditedPlan(validated.data)
    setEditingJson(false)
  }

  const isLowConfidence = result.confidence < CONFIDENCE_THRESHOLD || result.contentType === 'other'

  return (
    <Card>
      <CardHeader>
        <CardTitle>{editedPlan.name}</CardTitle>
        <CardDescription>
          {t('reviewMeta', {
            weeks: editedPlan.weeks.length,
            confidence: (result.confidence * 100).toFixed(0),
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLowConfidence && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-1">
                <p className="font-medium">
                  {result.contentType === 'other' ? t('notRunningPlan') : t('lowConfidence')}
                </p>
                {result.warnings.length > 0 && (
                  <ul className="list-disc pl-5 text-sm">
                    {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                )}
                <p className="text-sm">{t('reviewWarning')}</p>
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
            {editingJson ? t('closeJsonEditor') : t('editJson')}
          </Button>
        </div>

        {editingJson && (
          <div className="space-y-2">
            <Textarea value={jsonText} onChange={e => setJsonText(e.target.value)} rows={20} className="font-mono text-xs" />
            {jsonError && (
              <pre className="rounded bg-destructive/10 p-2 text-xs text-destructive whitespace-pre-wrap">{jsonError}</pre>
            )}
            <Button size="sm" onClick={applyJson}>{t('validateApply')}</Button>
          </div>
        )}

        <div className="space-y-4">
          {editedPlan.weeks.map((week) => (
            <div key={week.week_index} className="rounded-md border p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{t('weekLabel', { index: week.week_index })}</span>
                {week.phase && <Badge variant="secondary">{t(`phase_${week.phase}`)}</Badge>}
                {week.label && <span className="text-xs italic text-muted-foreground">{week.label}</span>}
              </div>
              <ul className="space-y-1.5">
                {week.workouts.map((w, i) => <WorkoutLine key={i} workout={w} />)}
              </ul>
            </div>
          ))}
        </div>
      </CardContent>
      <CardFooter className="flex justify-between gap-2">
        <div className="flex gap-2">
          <Button variant="outline" onClick={onBack} disabled={submitting}>{t('back')}</Button>
          <Button variant="ghost" onClick={onStartOver} disabled={submitting}>{t('startOver')}</Button>
        </div>
        <Button onClick={() => onConfirm(editedPlan)} disabled={submitting}>
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {submitting ? t('importing') : t('importPlan')}
        </Button>
      </CardFooter>
    </Card>
  )
}

const DAY_NAMES = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

function WorkoutLine({ workout }: { workout: ImportedWorkout }) {
  const t = useTranslations('planImport')
  const { workoutType } = useEnumLabels()
  const dayKey = DAY_NAMES[Math.min(6, Math.max(0, workout.day_of_week - 1))]
  return (
    <li className="flex items-start gap-2 text-sm">
      <span className="w-10 shrink-0 text-xs font-medium text-muted-foreground">{t(`day_${dayKey}`)}</span>
      <span className="flex-1">
        <span className="font-medium">{workoutType(workout.type)}</span>
        {' — '}
        <span className="text-muted-foreground">{workout.description}</span>
        {typeof workout.distance_meters === 'number' && workout.distance_meters > 0 && (
          <Badge variant="outline" className="ml-2 text-[10px]">{(workout.distance_meters / 1000).toFixed(1)} km</Badge>
        )}
      </span>
    </li>
  )
}
