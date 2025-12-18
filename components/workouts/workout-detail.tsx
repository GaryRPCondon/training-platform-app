'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { PlannedWorkout, TrainingPaces } from '@/types'
import { formatPace, estimateDuration, getWorkoutPaceType } from '@/lib/training/vdot'

interface WorkoutDetailProps {
    workout: PlannedWorkout
    trainingPaces?: TrainingPaces | null
    vdot?: number | null
    onEdit?: () => void
    onDelete?: () => void
}

export function WorkoutDetail({ workout, trainingPaces, vdot, onEdit, onDelete }: WorkoutDetailProps) {
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
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">{workout.description || workout.workout_type}</h3>
                <Badge variant={
                    workout.status === 'completed' ? 'default' :
                        workout.status === 'scheduled' ? 'secondary' : 'destructive'
                }>
                    {workout.status}
                </Badge>
            </div>

            <div className="grid gap-4">
                <div>
                    <div className="text-sm text-muted-foreground">Date</div>
                    <div>{new Date(workout.scheduled_date).toLocaleDateString()}</div>
                </div>

                {workout.distance_target_meters && (
                    <div>
                        <div className="text-sm text-muted-foreground">Distance Target</div>
                        <div>{(workout.distance_target_meters / 1000).toFixed(1)} km</div>
                    </div>
                )}

                <div>
                    <div className="text-sm text-muted-foreground">Intensity</div>
                    <Badge variant="outline">{workout.intensity_target || 'Not set'}</Badge>
                </div>

                {targetPace !== null && (
                    <div>
                        <div className="text-sm text-muted-foreground">{paceLabel} Pace</div>
                        <div>{formatPace(targetPace)} {vdot && <span className="text-xs text-muted-foreground">(VDOT {vdot})</span>}</div>
                    </div>
                )}

                {estimatedDurationMinutes !== null && (
                    <div>
                        <div className="text-sm text-muted-foreground">Estimated Duration</div>
                        <div>{estimatedDurationMinutes} minutes</div>
                    </div>
                )}

                <div className="flex gap-2 pt-4">
                    <Button onClick={onEdit} variant="outline" size="sm">Edit</Button>
                    <Button onClick={onDelete} variant="destructive" size="sm">Delete</Button>
                </div>
            </div>
        </div>
    )
}
