'use client'

/**
 * PlanDiffPreview - Phase 5 Chat Refinement
 *
 * Shows a preview of LLM-regenerated weeks before applying changes.
 * Displays:
 * - Intent summary (what the LLM understood)
 * - Affected weeks
 * - Before/after workout comparison
 * - Validation warnings
 * - Approve/Reject actions
 */

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { CheckCircle2, XCircle, AlertTriangle, Loader2 } from 'lucide-react'

interface RegeneratedWeek {
  week_number: number
  phase_name: string
  weekly_volume_km: number
  workouts: Array<{
    day: number
    workout_type: string
    description: string
    distance_km: number | null
    intensity_target: string
  }>
}

interface RegenerationPreview {
  intent_summary: string
  affected_weeks: number[]
  regenerated_weeks: RegeneratedWeek[]
  validation: {
    valid: boolean
    errors: string[]
    formatted_errors: string | null
  }
  metadata: {
    llm_provider: string
    llm_duration_seconds: number
    estimated_input_tokens: number
    weeks_to_replace: number
    workouts_to_create: number
  }
}

interface PlanDiffPreviewProps {
  preview: RegenerationPreview
  originalWeeks: Array<{
    week_number: number
    phase_name: string
    weekly_volume_km: number
    workouts: Array<{
      day: number
      workout_type: string
      description: string
      distance_km: number | null
    }>
  }>
  onApprove: (regeneratedWeeks: RegeneratedWeek[]) => Promise<void>
  onReject: () => void
}

export function PlanDiffPreview({
  preview,
  originalWeeks,
  onApprove,
  onReject
}: PlanDiffPreviewProps) {
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleApprove = async () => {
    setApplying(true)
    setError(null)
    try {
      await onApprove(preview.regenerated_weeks)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply changes')
      setApplying(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Intent Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            Plan Modification Preview
          </CardTitle>
          <CardDescription>{preview.intent_summary}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>Provider: {preview.metadata.llm_provider}</span>
            <span>•</span>
            <span>Generated in {preview.metadata.llm_duration_seconds}s</span>
            <span>•</span>
            <span>
              {preview.metadata.weeks_to_replace} week
              {preview.metadata.weeks_to_replace > 1 ? 's' : ''} affected
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Validation Warnings */}
      {!preview.validation.valid && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <div className="font-medium mb-2">Validation Warnings:</div>
            <div className="whitespace-pre-line text-sm">
              {preview.validation.formatted_errors}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Week-by-Week Comparison */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Changes Preview</h3>
        {preview.regenerated_weeks.map(newWeek => {
          const originalWeek = originalWeeks.find(w => w.week_number === newWeek.week_number)

          return (
            <Card key={newWeek.week_number}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">
                    Week {newWeek.week_number} ({newWeek.phase_name})
                  </CardTitle>
                  <Badge
                    variant={
                      Math.abs(newWeek.weekly_volume_km - (originalWeek?.weekly_volume_km || 0)) > 5
                        ? 'default'
                        : 'secondary'
                    }
                  >
                    {originalWeek?.weekly_volume_km.toFixed(1)}km →{' '}
                    {newWeek.weekly_volume_km.toFixed(1)}km
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Before */}
                  <div>
                    <h4 className="text-sm font-medium mb-2 text-muted-foreground">Before</h4>
                    <div className="space-y-1">
                      {originalWeek?.workouts.map(workout => (
                        <div
                          key={workout.day}
                          className="text-sm p-2 bg-muted/50 rounded"
                        >
                          <span className="font-medium">Day {workout.day}:</span>{' '}
                          {workout.description}
                          {workout.distance_km && (
                            <span className="text-muted-foreground ml-1">
                              ({workout.distance_km.toFixed(1)}km)
                            </span>
                          )}
                        </div>
                      )) || (
                        <div className="text-sm text-muted-foreground italic">
                          No original week data
                        </div>
                      )}
                    </div>
                  </div>

                  {/* After */}
                  <div>
                    <h4 className="text-sm font-medium mb-2 text-green-600">After</h4>
                    <div className="space-y-1">
                      {newWeek.workouts.map(workout => {
                        const originalWorkout = originalWeek?.workouts.find(
                          w => w.day === workout.day
                        )

                        // More precise change detection
                        const typeChanged = originalWorkout?.workout_type !== workout.workout_type
                        const descChanged = originalWorkout?.description !== workout.description
                        const distanceChanged = Math.abs(
                          (originalWorkout?.distance_km || 0) - (workout.distance_km || 0)
                        ) > 0.1

                        const isChanged = !originalWorkout || typeChanged || descChanged || distanceChanged

                        // Debug logging for incorrectly detected changes
                        if (isChanged && originalWorkout && !typeChanged && !distanceChanged) {
                          console.log(`Week ${newWeek.week_number} Day ${workout.day} marked changed:`, {
                            originalDesc: originalWorkout.description,
                            newDesc: workout.description,
                            descChanged,
                            originalType: originalWorkout.workout_type,
                            newType: workout.workout_type,
                            typeChanged
                          })
                        }

                        return (
                          <div
                            key={workout.day}
                            className={`text-sm p-2 rounded ${
                              isChanged
                                ? 'bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800'
                                : 'bg-muted/50'
                            }`}
                          >
                            <span className="font-medium">Day {workout.day}:</span>{' '}
                            {workout.description}
                            {workout.distance_km && (
                              <span className="text-muted-foreground ml-1">
                                ({workout.distance_km.toFixed(1)}km)
                              </span>
                            )}
                            {isChanged && (
                              <Badge variant="outline" className="ml-2 text-xs">
                                Modified
                              </Badge>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Error Display */}
      {error && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Actions */}
      <div className="flex gap-3 justify-end">
        <Button variant="outline" onClick={onReject} disabled={applying}>
          Cancel
        </Button>
        <Button onClick={handleApprove} disabled={applying}>
          {applying ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Applying Changes...
            </>
          ) : (
            <>
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Apply Changes
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
