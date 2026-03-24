'use client'

import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CalendarCheck, Coffee, CheckCircle2, AlertCircle } from 'lucide-react'
import { getCurrentAthleteId } from '@/lib/supabase/client'
import { createClient } from '@/lib/supabase/client'
import { useUnits } from '@/lib/hooks/use-units'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'

function extractPaceSummary(sw: Record<string, unknown> | null): string | null {
    if (!sw) return null
    if (sw.pace_guidance) return sw.pace_guidance as string
    if (sw.main_set && Array.isArray(sw.main_set)) {
        const firstSet = sw.main_set[0] as Record<string, unknown> | undefined
        if (firstSet?.intervals && Array.isArray(firstSet.intervals)) {
            const firstInterval = (firstSet.intervals as Record<string, unknown>[])[0]
            if (firstInterval?.target_pace) return `${firstInterval.target_pace}`
            if (firstInterval?.intensity) return firstInterval.intensity as string
        }
    }
    return null
}

function formatWorkoutType(type: string): string {
    return type
        .split('_')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
}

export function TodaysWorkoutCard() {
    const { toDisplayDistance, distanceLabel } = useUnits()
    const router = useRouter()
    const supabase = createClient()

    const { data: workout, isLoading } = useQuery({
        queryKey: ['todays-workout'],
        queryFn: async () => {
            const athleteId = await getCurrentAthleteId()
            const today = format(new Date(), 'yyyy-MM-dd')

            const { data } = await supabase
                .from('planned_workouts')
                .select('*')
                .eq('athlete_id', athleteId)
                .eq('scheduled_date', today)
                .neq('workout_type', 'rest')
                .order('id', { ascending: true })
                .limit(1)
                .maybeSingle()

            return data
        },
    })

    if (isLoading) return null

    const isCompleted = workout?.completion_status === 'completed'
    const isPartial = workout?.completion_status === 'partial'
    const hasWorkout = !!workout

    const handleClick = () => {
        if (hasWorkout) {
            router.push(`/dashboard/calendar?workoutId=${workout.id}`)
        } else {
            router.push('/dashboard/calendar')
        }
    }

    const paceSummary = hasWorkout
        ? extractPaceSummary(workout.structured_workout as Record<string, unknown> | null)
        : null

    return (
        <Card
            className="cursor-pointer transition-colors hover:bg-accent/50"
            onClick={handleClick}
        >
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <CalendarCheck className="h-5 w-5" />
                    Today&apos;s Planned Workout
                </CardTitle>
                {isCompleted && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                {isPartial && <AlertCircle className="h-4 w-4 text-yellow-500" />}
            </CardHeader>
            <CardContent>
                {hasWorkout ? (
                    <div className="space-y-1">
                        <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm">
                                {formatWorkoutType(workout.workout_type)}
                            </span>
                            {workout.intensity_target && (
                                <Badge variant="secondary" className="text-xs">
                                    {workout.intensity_target}
                                </Badge>
                            )}
                            {isCompleted && (
                                <Badge variant="default" className="text-xs bg-emerald-500">
                                    Completed
                                </Badge>
                            )}
                            {isPartial && (
                                <Badge variant="secondary" className="text-xs bg-yellow-500 text-white">
                                    Partial
                                </Badge>
                            )}
                        </div>
                        {workout.description && (
                            <p className="text-sm text-muted-foreground truncate">
                                {workout.description}
                            </p>
                        )}
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            {workout.distance_target_meters && (
                                <span>
                                    {toDisplayDistance(workout.distance_target_meters).toFixed(1)}{distanceLabel()}
                                </span>
                            )}
                            {paceSummary && (
                                <span>{paceSummary}</span>
                            )}
                        </div>
                    </div>
                ) : (
                    <div>
                        <p className="text-sm font-medium">Rest Day</p>
                        <p className="text-xs text-muted-foreground mt-1">
                            No workout scheduled
                        </p>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
