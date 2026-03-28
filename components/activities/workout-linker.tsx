'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import type { Activity, PlannedWorkout } from '@/types/database'
import { Link2, Unlink, Calendar, Target, CheckCircle } from 'lucide-react'
import { toast } from 'sonner'
import { format, parseISO, subDays, addDays } from 'date-fns'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { useUnits } from '@/lib/hooks/use-units'
import { calculateTotalWorkoutDistance } from '@/lib/training/vdot'
import { interpretAccuracyScore } from '@/lib/activities/scoring'

interface WorkoutLinkerProps {
  activity: Activity
  currentWorkout?: PlannedWorkout | null
  onClose?: () => void
}

export function WorkoutLinker({ activity, currentWorkout, onClose }: WorkoutLinkerProps) {
  const [nearbyWorkouts, setNearbyWorkouts] = useState<PlannedWorkout[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()
  const queryClient = useQueryClient()
  const { formatDistance } = useUnits()

  // Load nearby workouts for manual linking
  useEffect(() => {
    if (!activity.start_time) return

    const loadNearbyWorkouts = async () => {
      try {
        const activityDate = parseISO(activity.start_time!)
        const startDate = format(subDays(activityDate, 3), 'yyyy-MM-dd')
        const endDate = format(addDays(activityDate, 3), 'yyyy-MM-dd')

        const response = await fetch(
          `/api/workouts?startDate=${startDate}&endDate=${endDate}`
        )

        if (response.ok) {
          const data = await response.json()
          // Filter out the current workout if linked
          const filtered = currentWorkout
            ? data.filter((w: PlannedWorkout) => w.id !== currentWorkout.id)
            : data
          setNearbyWorkouts(filtered)
        }
      } catch (error) {
        console.error('Failed to load nearby workouts:', error)
      }
    }

    loadNearbyWorkouts()
  }, [activity.start_time, currentWorkout])

  const handleLink = async (workoutId: number) => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/activities/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activityId: activity.id,
          workoutId,
          reason: 'Manual link from activity detail page',
        }),
      })

      if (!response.ok) throw new Error('Failed to link')

      // Invalidate queries to refresh calendar data
      queryClient.invalidateQueries({ queryKey: ['workouts'] })
      queryClient.invalidateQueries({ queryKey: ['activities'] })

      toast.success('Activity linked to workout')

      // Close modal after short delay to allow user to see success message
      setTimeout(() => {
        if (onClose) onClose()
        router.refresh()
      }, 800)
    } catch (error) {
      toast.error('Failed to link activity')
      console.error('Link error:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleUnlink = async () => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/activities/link', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activityId: activity.id }),
      })

      if (!response.ok) throw new Error('Failed to unlink')

      // Invalidate queries to refresh calendar data
      queryClient.invalidateQueries({ queryKey: ['workouts'] })
      queryClient.invalidateQueries({ queryKey: ['activities'] })

      toast.success('Activity unlinked from workout')

      // Close modal after short delay to allow user to see success message
      setTimeout(() => {
        if (onClose) onClose()
        router.refresh()
      }, 800)
    } catch (error) {
      toast.error('Failed to unlink activity')
      console.error('Unlink error:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const getConfidenceBadge = (confidence: number | null) => {
    if (!confidence) return null

    const percentage = Math.round(confidence * 100)
    const variant = confidence >= 0.8 ? 'default' : confidence >= 0.6 ? 'secondary' : 'outline'

    return (
      <Badge variant={variant}>
        {percentage}% confidence
      </Badge>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Link2 className="h-5 w-5" />
              Workout Linking
            </CardTitle>
            <CardDescription>
              Link this activity to a planned workout
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current Workout Link */}
        {currentWorkout ? (
          <Alert>
            <CheckCircle className="h-4 w-4 text-green-500" />
            <AlertDescription>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">
                      Linked to {currentWorkout.workout_type
                        .split('_')
                        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                        .join(' ')}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Scheduled: {format(parseISO(currentWorkout.scheduled_date), 'PPP')}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      {activity.match_confidence && getConfidenceBadge(activity.match_confidence)}
                      {activity.match_method && (
                        <Badge variant="outline" className="text-xs">
                          {activity.match_method === 'auto_time' ? 'Auto (Time)' :
                           activity.match_method === 'auto_distance' ? 'Auto (Distance)' :
                           'Manual'}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleUnlink}
                    disabled={isLoading}
                  >
                    <Unlink className="h-4 w-4 mr-2" />
                    Unlink
                  </Button>
                </div>

                {/* Show target vs actual comparison — each metric independent */}
                {(() => {
                  const effectiveDistance = calculateTotalWorkoutDistance(
                    currentWorkout.distance_target_meters,
                    currentWorkout.workout_type,
                    currentWorkout.structured_workout as Record<string, unknown> | null,
                    null
                  ) || currentWorkout.distance_target_meters
                  const variancePercent = (effectiveDistance && activity.distance_meters)
                    ? ((activity.distance_meters - effectiveDistance) / effectiveDistance) * 100
                    : null
                  const hasAnyMetric = effectiveDistance || currentWorkout.duration_target_seconds || (currentWorkout.completion_metadata as any)?.accuracy_score != null
                  if (!hasAnyMetric) return null
                  return (
                  <div className="text-sm border-t pt-2">
                    {effectiveDistance && activity.distance_meters && (
                      <>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Target Distance:</span>
                          <span className="font-medium">
                            {formatDistance(effectiveDistance, 1)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Actual Distance:</span>
                          <span className="font-medium">
                            {formatDistance(activity.distance_meters, 1)}
                          </span>
                        </div>
                        {variancePercent !== null && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Variance:</span>
                            <span className={`font-medium ${
                              Math.abs(variancePercent) > 20
                                ? 'text-red-600'
                                : Math.abs(variancePercent) > 10
                                ? 'text-yellow-600'
                                : 'text-green-600'
                            }`}>
                              {variancePercent > 0 ? '+' : ''}
                              {variancePercent.toFixed(1)}%
                            </span>
                          </div>
                        )}
                      </>
                    )}
                    {currentWorkout.duration_target_seconds && activity.duration_seconds && (
                      <>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Target Duration:</span>
                          <span className="font-medium">
                            {Math.round(currentWorkout.duration_target_seconds / 60)} min
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Actual Duration:</span>
                          <span className="font-medium">
                            {Math.round(activity.duration_seconds / 60)} min
                          </span>
                        </div>
                      </>
                    )}
                    {(() => {
                      const display = interpretAccuracyScore(
                        (currentWorkout.completion_metadata as any)?.accuracy_score ?? null,
                        currentWorkout.workout_type
                      )
                      if (!display?.show) return null
                      return (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">{display.label}:</span>
                          <span className={`font-medium ${display.colorClass}`}>
                            {display.score}%
                          </span>
                        </div>
                      )
                    })()}
                  </div>
                  )
                })()}
              </div>
            </AlertDescription>
          </Alert>
        ) : (
          <Alert>
            <AlertDescription>
              This activity is not linked to any workout
            </AlertDescription>
          </Alert>
        )}

        {/* Nearby Workouts for Manual Linking */}
        {!currentWorkout && nearbyWorkouts.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Nearby Workouts</h4>
            <div className="space-y-2">
              {nearbyWorkouts.map((workout) => (
                <div
                  key={workout.id}
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50"
                >
                  <div className="space-y-1">
                    <div className="font-medium">
                      {workout.workout_type
                        .split('_')
                        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                        .join(' ')}
                    </div>
                    <div className="text-sm text-muted-foreground flex items-center gap-2">
                      <Calendar className="h-3 w-3" />
                      {format(parseISO(workout.scheduled_date), 'PPP')}
                      {workout.distance_target_meters && (
                        <>
                          <Target className="h-3 w-3 ml-2" />
                          {formatDistance(workout.distance_target_meters, 1)}
                        </>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleLink(workout.id)}
                    disabled={isLoading}
                  >
                    <Link2 className="h-4 w-4 mr-2" />
                    Link
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
