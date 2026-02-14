'use client'

import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { WorkoutLinker } from './workout-linker'
import { format, parseISO } from 'date-fns'
import type { Activity, PlannedWorkout } from '@/types/database'
import { Activity as ActivityIcon, Calendar, Clock, TrendingUp, Gauge, Mountain } from 'lucide-react'
import { useUnits } from '@/lib/hooks/use-units'

interface ActivityDetailProps {
  activity: Activity & { planned_workouts?: PlannedWorkout | null }
  onClose?: () => void
}

export function ActivityDetail({ activity, onClose }: ActivityDetailProps) {
  const { formatDistance, formatPace, formatElevation } = useUnits()

  // Calculate pace if we have distance and duration
  let avgPace: string | null = null
  if (activity.distance_meters && activity.duration_seconds) {
    const paceSecondsPerKm = (activity.duration_seconds / (activity.distance_meters / 1000))
    avgPace = formatPace(paceSecondsPerKm)
  }

  return (
    <div className="space-y-4">
      {/* Activity Header */}
      <div>
        <div className="flex items-start justify-between mb-2">
          <div>
            <h2 className="text-2xl font-semibold">
              {activity.activity_name || 'Activity'}
            </h2>
            {activity.start_time && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2">
                <Calendar className="h-4 w-4" />
                {format(parseISO(activity.start_time), 'PPp')}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            {activity.activity_type && (
              <Badge variant="outline">{activity.activity_type}</Badge>
            )}
            {activity.source && (
              <Badge variant="secondary">{activity.source}</Badge>
            )}
          </div>
        </div>

        <div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
            {/* Distance */}
            {activity.distance_meters && (
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <ActivityIcon className="h-4 w-4" />
                  Distance
                </div>
                <div className="text-2xl font-bold">
                  {formatDistance(activity.distance_meters)}
                </div>
              </div>
            )}

            {/* Duration */}
            {activity.duration_seconds && (
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  Duration
                </div>
                <div className="text-2xl font-bold">
                  {Math.floor(activity.duration_seconds / 3600) > 0 && (
                    <>{Math.floor(activity.duration_seconds / 3600)}h </>
                  )}
                  {Math.floor((activity.duration_seconds % 3600) / 60)}m
                </div>
              </div>
            )}

            {/* Average Pace */}
            {avgPace && (
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Gauge className="h-4 w-4" />
                  Average Pace
                </div>
                <div className="text-2xl font-bold">
                  {avgPace}
                </div>
              </div>
            )}

            {/* Average Heart Rate */}
            {activity.avg_hr && (
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <TrendingUp className="h-4 w-4" />
                  Average HR
                </div>
                <div className="text-2xl font-bold">
                  {activity.avg_hr} bpm
                </div>
              </div>
            )}

            {/* Max Heart Rate */}
            {activity.max_hr && (
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <TrendingUp className="h-4 w-4" />
                  Max HR
                </div>
                <div className="text-2xl font-bold">
                  {activity.max_hr} bpm
                </div>
              </div>
            )}

            {/* Elevation Gain */}
            {activity.elevation_gain_meters && (
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Mountain className="h-4 w-4" />
                  Elevation Gain
                </div>
                <div className="text-2xl font-bold">
                  {formatElevation(activity.elevation_gain_meters)}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <Separator />

      {/* Workout Linker */}
      <WorkoutLinker
        activity={activity}
        currentWorkout={activity.planned_workouts}
        onClose={onClose}
      />
    </div>
  )
}
