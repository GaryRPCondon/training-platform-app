'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import type { WorkoutWithDetails } from '@/types/review'
import type { TrainingPaces } from '@/types/database'
import { Calendar, Clock, TrendingUp, Target, Gauge, Flag, RotateCcw, CheckCircle, AlertCircle, XCircle } from 'lucide-react'
import { formatPace, estimateDuration, getWorkoutPaceType } from '@/lib/training/vdot'

interface WorkoutCardProps {
  workout: WorkoutWithDetails
  trainingPaces?: TrainingPaces | null
  vdot?: number | null
  onClose?: () => void
  onDiscuss?: (workout: WorkoutWithDetails) => void
}

export function WorkoutCard({ workout, trainingPaces, vdot, onClose, onDiscuss }: WorkoutCardProps) {
  const hasStructuredWorkout = workout.structured_workout &&
    typeof workout.structured_workout === 'object'

  // Calculate target pace and estimated duration if we have training paces
  let targetPace: number | null = null
  let estimatedDurationMinutes: number | null = null
  let paceLabel: string | null = null

  if (trainingPaces && workout.distance_target_meters && workout.workout_type) {
    const paceType = getWorkoutPaceType(workout.workout_type)
    targetPace = trainingPaces[paceType]
    estimatedDurationMinutes = Math.round(estimateDuration(workout.distance_target_meters, targetPace) / 60)
    // Capitalize pace type for display (e.g., "interval" -> "Interval")
    paceLabel = paceType.charAt(0).toUpperCase() + paceType.slice(1)
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xl font-semibold">
            {workout.workout_type
              .split('_')
              .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
              .join(' ')}
          </h3>
          <Badge variant="outline">{workout.workout_index}</Badge>
        </div>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-1">
            <Calendar className="h-4 w-4" />
            {workout.formatted_date}
          </div>
          <Badge variant="secondary">{workout.phase_name}</Badge>
        </div>
      </div>

      {/* Completion Status */}
      {workout.completion_status && workout.completion_status !== 'pending' && (
        <div className="flex items-center gap-2 text-sm">
          {workout.completion_status === 'completed' && (
            <>
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span className="text-green-600 font-medium">Completed</span>
            </>
          )}
          {workout.completion_status === 'partial' && (
            <>
              <AlertCircle className="h-4 w-4 text-yellow-500" />
              <span className="text-yellow-600 font-medium">Partial</span>
            </>
          )}
          {workout.completion_status === 'skipped' && (
            <>
              <XCircle className="h-4 w-4 text-red-500" />
              <span className="text-red-600 font-medium">Skipped</span>
            </>
          )}

          {/* Show variance if exists */}
          {workout.completion_metadata?.distance_variance_percent !== undefined &&
           Math.abs(workout.completion_metadata.distance_variance_percent) > 10 && (
            <span className="text-xs text-muted-foreground">
              ({workout.completion_metadata.distance_variance_percent > 0 ? '+' : ''}
              {workout.completion_metadata.distance_variance_percent.toFixed(0)}%)
            </span>
          )}
        </div>
      )}

      <Separator />

      {/* Validation Warning */}
      {workout.validation_warning && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-2">
          <div className="flex items-start gap-2">
            <Flag className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1 space-y-1">
              <p className="text-sm font-medium text-red-900">
                ⚠️ Possible LLM Hallucination
              </p>
              <p className="text-xs text-red-800">
                This workout has an unusual distance that may be due to an AI calculation error.
              </p>
              <p className="text-xs text-red-700 font-mono">
                Distance: {(workout.validation_warning.actualDistance / 1000).toFixed(1)}km
                (expected: {(workout.validation_warning.expectedRange.min / 1000).toFixed(1)}-
                {(workout.validation_warning.expectedRange.max / 1000).toFixed(1)}km for {workout.workout_type})
              </p>
              <div className="flex items-center gap-1 mt-2">
                <RotateCcw className="h-3 w-3 text-red-600" />
                <p className="text-xs text-red-700 font-medium">
                  Consider regenerating the plan if this looks incorrect
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Description */}
      {workout.description && (
        <div>
          <p className="text-sm text-muted-foreground">{workout.description}</p>
        </div>
      )}

      {/* Targets */}
      <div className="grid grid-cols-2 gap-4">
        {workout.distance_target_meters && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Target className="h-4 w-4" />
              Distance Target
            </div>
            <div className="text-lg font-medium">
              {(workout.distance_target_meters / 1000).toFixed(1)} km
            </div>
          </div>
        )}

        {workout.intensity_target && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <TrendingUp className="h-4 w-4" />
              Intensity
            </div>
            <Badge>{workout.intensity_target}</Badge>
          </div>
        )}

        {targetPace !== null && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Gauge className="h-4 w-4" />
              {paceLabel} Pace
            </div>
            <div className="text-lg font-medium">
              {formatPace(targetPace)}
            </div>
            {vdot && (
              <div className="text-xs text-muted-foreground">
                VDOT {vdot}
              </div>
            )}
          </div>
        )}

        {estimatedDurationMinutes !== null && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              Estimated Duration
            </div>
            <div className="text-lg font-medium">
              {estimatedDurationMinutes} min
            </div>
          </div>
        )}
      </div>

      {/* Structured Workout Details */}
      {hasStructuredWorkout && (
        <>
          <Separator />
          <div>
            <h4 className="font-medium mb-2">Workout Structure</h4>
            <div className="text-sm space-y-1">
              {renderStructuredWorkout(workout.structured_workout as any)}
            </div>
          </div>
        </>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        {onDiscuss && (
          <Button
            onClick={() => onDiscuss(workout)}
            variant="default"
            className="flex-1"
          >
            Discuss with AI Coach
          </Button>
        )}
        {onClose && (
          <Button onClick={onClose} variant="outline">
            Close
          </Button>
        )}
      </div>
    </div>
  )
}

function renderStructuredWorkout(structure: any): React.ReactNode {
  if (!structure) return null

  const parts: string[] = []

  if (structure.warmup) {
    parts.push(`Warmup: ${formatWorkoutPart(structure.warmup)}`)
  }

  if (structure.main_set) {
    if (Array.isArray(structure.main_set)) {
      structure.main_set.forEach((set: any, i: number) => {
        if (set.repeat && set.intervals) {
          const intervals = set.intervals.map((int: any) => formatInterval(int)).join(', ')
          parts.push(`Set ${i + 1}: ${set.repeat}x (${intervals})`)
        }
      })
    } else {
      parts.push(`Main: ${formatWorkoutPart(structure.main_set)}`)
    }
  }

  if (structure.cooldown) {
    parts.push(`Cooldown: ${formatWorkoutPart(structure.cooldown)}`)
  }

  return (
    <div className="space-y-1">
      {parts.map((part, i) => (
        <div key={i} className="text-muted-foreground">{part}</div>
      ))}
    </div>
  )
}

function formatWorkoutPart(part: any): string {
  const details: string[] = []

  if (part.duration_minutes) {
    details.push(`${part.duration_minutes}min`)
  }
  if (part.distance_meters) {
    details.push(`${(part.distance_meters / 1000).toFixed(1)}km`)
  }
  if (part.intensity) {
    details.push(part.intensity)
  }
  if (part.target_pace) {
    details.push(`@ ${part.target_pace}`)
  }

  return details.join(' ')
}

function formatInterval(interval: any): string {
  const parts: string[] = []

  if (interval.distance_meters) {
    parts.push(`${interval.distance_meters}m`)
  }
  if (interval.duration_seconds) {
    parts.push(`${interval.duration_seconds}s`)
  }
  if (interval.target_pace) {
    parts.push(`@ ${interval.target_pace}`)
  }
  if (interval.intensity) {
    parts.push(interval.intensity)
  }

  return parts.join(' ')
}
