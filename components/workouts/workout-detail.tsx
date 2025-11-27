'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { PlannedWorkout } from '@/types'

interface WorkoutDetailProps {
    workout: PlannedWorkout
    onEdit?: () => void
    onDelete?: () => void
}

export function WorkoutDetail({ workout, onEdit, onDelete }: WorkoutDetailProps) {
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

                {workout.duration_target_seconds && (
                    <div>
                        <div className="text-sm text-muted-foreground">Duration Target</div>
                        <div>{Math.floor(workout.duration_target_seconds / 60)} minutes</div>
                    </div>
                )}

                <div>
                    <div className="text-sm text-muted-foreground">Intensity</div>
                    <Badge variant="outline">{workout.intensity_target || 'Not set'}</Badge>
                </div>

                <div className="flex gap-2 pt-4">
                    <Button onClick={onEdit} variant="outline" size="sm">Edit</Button>
                    <Button onClick={onDelete} variant="destructive" size="sm">Delete</Button>
                </div>
            </div>
        </div>
    )
}
