'use client'

/**
 * OperationsPreview - Phase 5 Operations-Based Plan Modification
 *
 * Displays a preview of operations that will be applied to the plan.
 * Much simpler than the full week diff preview since operations are discrete.
 *
 * Shows:
 * - List of operations with human-readable descriptions
 * - Affected workouts with before/after states
 * - Approve/Reject buttons
 */

import { useState, Fragment } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import {
  Loader2,
  Check,
  X,
  ArrowRight,
  Calendar,
  Repeat,
  Move,
  Scale,
  AlertCircle,
  ChevronDown,
  ChevronUp
} from 'lucide-react'
import { useUnits } from '@/lib/hooks/use-units'

interface Operation {
  op: string
  description: string
  [key: string]: any
}

interface AffectedWorkout {
  workoutId: number
  weekNumber: number
  day: number
  before: {
    date: string
    type: string
    description: string
    distanceKm: number | null
  }
  after: {
    date: string
    type: string
    description: string
    distanceKm: number | null
  }
}

interface OperationsPreviewProps {
  preview: {
    summary: string
    operations: Operation[]
    affected_workouts: AffectedWorkout[]
    validation: {
      valid: boolean
      errors: string[]
      warnings: string[]
    }
    metadata: {
      llm_provider: string
      llm_duration_seconds: number
      estimated_input_tokens: number
      operations_count: number
      week_starts_on: number
    }
  }
  onApprove: () => Promise<void>
  onReject: () => void
  loading?: boolean
}

/**
 * Get icon for operation type
 */
function getOperationIcon(op: string) {
  switch (op) {
    case 'swap_days':
      return <Repeat className="h-4 w-4" />
    case 'move_workout_type':
      return <Move className="h-4 w-4" />
    case 'reschedule_workout':
      return <Calendar className="h-4 w-4" />
    case 'scale_week_volume':
    case 'scale_workout_distance':
    case 'scale_phase_volume':
      return <Scale className="h-4 w-4" />
    default:
      return <ArrowRight className="h-4 w-4" />
  }
}

/**
 * Get badge variant for operation type
 */
function getOperationBadge(op: string): 'default' | 'secondary' | 'outline' {
  if (op.startsWith('scale_')) return 'secondary'
  if (op.startsWith('move_') || op === 'swap_days') return 'default'
  return 'outline'
}

/**
 * Convert day number to day name based on week start
 */
function getDayName(dayNumber: number, weekStartsOn: number): string {
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const calendarDay = (weekStartsOn + dayNumber - 1) % 7
  return dayNames[calendarDay]
}

/**
 * Calculate day number (1-7) from ISO date string based on week start
 */
function calculateDayNumber(dateStr: string, weekStartsOn: number): number {
  const date = new Date(dateStr + 'T00:00:00')
  const dayOfWeek = date.getDay() // 0-6, where 0=Sunday

  // Convert calendar day to plan day (1-7 relative to week start)
  const planDay = ((dayOfWeek - weekStartsOn + 7) % 7) + 1
  return planDay
}

export function OperationsPreview({
  preview,
  onApprove,
  onReject,
  loading = false
}: OperationsPreviewProps) {
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showWeekView, setShowWeekView] = useState(false)
  const { toDisplayDistance, distanceLabel } = useUnits()

  const handleApprove = async () => {
    setApplying(true)
    setError(null)
    try {
      await onApprove()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply changes')
    } finally {
      setApplying(false)
    }
  }

  const { operations, affected_workouts, validation, metadata } = preview

  // Group affected workouts by week
  const workoutsByWeek = affected_workouts.reduce((acc, workout) => {
    const weekNum = workout.weekNumber
    if (!acc[weekNum]) {
      acc[weekNum] = []
    }
    acc[weekNum].push(workout)
    return acc
  }, {} as Record<number, AffectedWorkout[]>)

  return (
    <div className="space-y-4">
      {/* Validation Warnings */}
      {validation.warnings.length > 0 && (
        <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950">
          <AlertCircle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-800 dark:text-amber-200">
            {validation.warnings.map((w, i) => (
              <div key={i}>{w}</div>
            ))}
          </AlertDescription>
        </Alert>
      )}

      {/* Validation Errors */}
      {!validation.valid && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {validation.errors.map((e, i) => (
              <div key={i}>{e}</div>
            ))}
          </AlertDescription>
        </Alert>
      )}

      {/* Operations List */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Operations ({operations.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {operations.filter(op => op && op.op).map((op, index) => (
            <div
              key={index}
              className="flex items-center gap-3 p-3 rounded-lg bg-muted/50"
            >
              <div className="flex-shrink-0 text-muted-foreground">
                {getOperationIcon(op.op)}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">{op.description}</p>
              </div>
              <Badge variant={getOperationBadge(op.op)} className="text-xs">
                {op.op.replace(/_/g, ' ')}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Affected Workouts Preview */}
      {affected_workouts.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Affected Workouts ({affected_workouts.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {affected_workouts.slice(0, 10).map((workout, index) => (
              <div
                key={index}
                className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 text-sm"
              >
                <div className="flex-shrink-0 text-muted-foreground">
                  W{workout.weekNumber}:D{workout.day}
                </div>
                <div className="flex-1 flex items-center gap-2">
                  {/* Before */}
                  <span className="text-muted-foreground">
                    {workout.before.type}
                    {workout.before.distanceKm != null && workout.before.distanceKm > 0 && ` (${toDisplayDistance(workout.before.distanceKm * 1000).toFixed(1)}${distanceLabel()})`}
                  </span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  {/* After */}
                  <span className="font-medium text-green-600 dark:text-green-400">
                    {workout.after.type}
                    {workout.after.distanceKm != null && workout.after.distanceKm > 0 && ` (${toDisplayDistance(workout.after.distanceKm * 1000).toFixed(1)}${distanceLabel()})`}
                  </span>
                </div>
                {workout.before.date !== workout.after.date && (
                  <Badge variant="outline" className="text-xs">
                    {workout.after.date}
                  </Badge>
                )}
              </div>
            ))}
            {affected_workouts.length > 10 && (
              <p className="text-xs text-muted-foreground text-center py-2">
                ... and {affected_workouts.length - 10} more workouts
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Toggle Week View Button */}
      {affected_workouts.length > 0 && Object.keys(workoutsByWeek).length > 0 && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowWeekView(!showWeekView)}
          >
            {showWeekView ? (
              <>
                <ChevronUp className="h-4 w-4 mr-2" />
                Hide week-by-week view
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4 mr-2" />
                View changes by week ({Object.keys(workoutsByWeek).length} weeks affected)
              </>
            )}
          </Button>
        </div>
      )}

      {/* Collapsible Week-by-Week View */}
      {showWeekView && Object.entries(workoutsByWeek).map(([weekNum, workouts]) => {
        // Create maps for before and after states by day
        const beforeByDay = new Map<number, { type: string; distanceKm: number | null }>()
        const afterByDay = new Map<number, { type: string; distanceKm: number | null }>()

        // Populate before and after maps
        workouts.forEach(w => {
          // Before: workout is on w.day
          beforeByDay.set(w.day, {
            type: w.before.type,
            distanceKm: w.before.distanceKm
          })

          // After: workout is on the new day
          const newDay = calculateDayNumber(w.after.date, metadata.week_starts_on)
          afterByDay.set(newDay, {
            type: w.after.type,
            distanceKm: w.after.distanceKm
          })
        })

        // Create array of all 7 days
        const allDays = Array.from({ length: 7 }, (_, i) => i + 1)

        return (
          <Card key={weekNum}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Week {weekNum}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                {/* Header Row */}
                <div className="grid grid-cols-3 gap-2 pb-2 border-b">
                  <div className="font-semibold text-sm text-muted-foreground">Day</div>
                  <div className="font-semibold text-sm text-muted-foreground">Before</div>
                  <div className="font-semibold text-sm text-muted-foreground">After</div>
                </div>

                {/* All 7 days */}
                {allDays.map(dayNum => {
                  const before = beforeByDay.get(dayNum)
                  const after = afterByDay.get(dayNum)
                  const dayName = getDayName(dayNum, metadata.week_starts_on)

                  // Changed if before and after are different
                  const isChanged = before || after

                  return (
                    <div
                      key={dayNum}
                      className={`grid grid-cols-3 gap-2 py-2 text-sm ${
                        isChanged ? 'bg-blue-50 dark:bg-blue-950/30' : ''
                      }`}
                    >
                      {/* Day Name */}
                      <div className="font-medium flex items-center">
                        {dayName}
                      </div>

                      {/* Before */}
                      <div className={`flex items-center ${!isChanged ? 'text-muted-foreground' : ''}`}>
                        {before ? (
                          <div>
                            <div>{before.type}</div>
                            {before.distanceKm != null && before.distanceKm > 0 && (
                              <div className="text-xs text-muted-foreground">
                                {toDisplayDistance(before.distanceKm * 1000).toFixed(1)}{distanceLabel()}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs italic">No change</span>
                        )}
                      </div>

                      {/* After */}
                      <div className={`flex items-center ${!isChanged ? 'text-muted-foreground' : 'font-medium'}`}>
                        {after ? (
                          <div>
                            <div className="text-green-700 dark:text-green-400">
                              {after.type}
                            </div>
                            {after.distanceKm != null && after.distanceKm > 0 && (
                              <div className="text-xs text-muted-foreground">
                                {toDisplayDistance(after.distanceKm * 1000).toFixed(1)}{distanceLabel()}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs italic">No change</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )
      })}

      {/* Error Display */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Action Buttons */}
      <div className="flex justify-end gap-3 pt-2">
        <Button variant="outline" onClick={onReject} disabled={applying || loading}>
          <X className="h-4 w-4 mr-2" />
          Cancel
        </Button>
        <Button
          onClick={handleApprove}
          disabled={applying || loading || !validation.valid}
        >
          {applying || loading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Applying...
            </>
          ) : (
            <>
              <Check className="h-4 w-4 mr-2" />
              Apply {operations.length} Operation{operations.length !== 1 ? 's' : ''}
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
