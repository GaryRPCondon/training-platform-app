'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import type { WorkoutWithDetails } from '@/types/review'
import { Calendar, Clock, TrendingUp, Target } from 'lucide-react'

interface WorkoutCardProps {
  workout: WorkoutWithDetails
  onClose?: () => void
  onDiscuss?: (workout: WorkoutWithDetails) => void
}

export function WorkoutCard({ workout, onClose, onDiscuss }: WorkoutCardProps) {
  const hasStructuredWorkout = workout.structured_workout &&
    typeof workout.structured_workout === 'object'

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

      <Separator />

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

        {workout.duration_target_seconds && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              Duration Target
            </div>
            <div className="text-lg font-medium">
              {Math.round(workout.duration_target_seconds / 60)} minutes
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
            Discuss with Coach
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
