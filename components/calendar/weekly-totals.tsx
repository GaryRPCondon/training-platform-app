'use client'

import { useMemo, useState } from 'react'
import { startOfWeek, endOfWeek, format, eachWeekOfInterval, startOfMonth, endOfMonth } from 'date-fns'
import { useUnits } from '@/lib/hooks/use-units'
import { Button } from '@/components/ui/button'

interface WorkoutRow {
    scheduled_date?: string | null
    date?: Date | string | null
    distance_target_meters?: number | null
    garmin_workout_id?: string | null
}

interface ActivityRow {
    start_time?: string | null
    distance_meters?: number | null
}

interface WeeklyTotalsProps {
    workouts: WorkoutRow[]
    activities?: ActivityRow[]
    currentDate: Date
    weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6
    showActual?: boolean
    garminConnected?: boolean
    onSendToGarmin?: (weekStart: Date, weekEnd: Date) => Promise<void>
    onRemoveFromGarmin?: (weekStart: Date, weekEnd: Date) => Promise<void>
}

export function WeeklyTotals({ workouts, activities = [], currentDate, weekStartsOn, showActual = false, garminConnected, onSendToGarmin, onRemoveFromGarmin }: WeeklyTotalsProps) {
    const [sendingWeek, setSendingWeek] = useState<string | null>(null)
    const [removingWeek, setRemovingWeek] = useState<string | null>(null)
    const { toDisplayDistance, distanceLabel } = useUnits()
    const weekTotals = useMemo(() => {
        // Calendar is month view only — always show weeks for the current month
        const monthStart = startOfMonth(currentDate)
        const monthEnd = endOfMonth(currentDate)

        // Match React Big Calendar logic:
        // Start: Start of the week containing the 1st of the month
        // End: End of the week containing the last day of the month
        const rangeStart = startOfWeek(monthStart, { weekStartsOn })
        const rangeEnd = endOfWeek(monthEnd, { weekStartsOn })

        // Get all weeks in the range
        const weeks = eachWeekOfInterval(
            { start: rangeStart, end: rangeEnd },
            { weekStartsOn }
        )

        // Calculate totals for each week
        return weeks.map(weekStart => {
            const weekEnd = endOfWeek(weekStart, { weekStartsOn })

            // Filter workouts in this week
            const weekWorkouts = workouts.filter(w => {
                const raw = w.scheduled_date ?? w.date
                if (!raw) return false
                const workoutDate = new Date(raw as string | Date)
                return workoutDate >= weekStart && workoutDate <= weekEnd
            })

            // Calculate planned distance
            const plannedMeters = weekWorkouts.reduce((sum, w) => {
                return sum + (w.distance_target_meters ?? 0)
            }, 0)

            // Calculate actual distance (from ALL activities in this week)
            const weekActivities = activities.filter(a => {
                if (!a.start_time) return false
                const activityDate = new Date(a.start_time)
                return activityDate >= weekStart && activityDate <= weekEnd
            })

            const actualMeters = weekActivities.reduce((sum, a) => {
                return sum + (a.distance_meters || 0)
            }, 0)

            // Format week label
            const weekLabel = `${format(weekStart, 'd')} - ${format(weekEnd, 'd MMM')}`

            const hasSyncedWorkouts = weekWorkouts.some(w => w.garmin_workout_id)

            return {
                weekLabel,
                weekStart,
                weekEnd,
                plannedMeters,
                actualMeters,
                hasSyncedWorkouts,
            }
        })
    }, [workouts, activities, currentDate, weekStartsOn])

    return (
        <div className="h-full flex flex-col bg-muted/20 border-l">
            {/* Header - fixed height to match calendar header row */}
            <div className="bg-muted/30 border-b px-3 text-sm font-semibold text-center h-[40px] flex items-center justify-center box-border selection:bg-none">
                Weekly Totals
            </div>

            {/* Weeks - flex to distribute evenly and align with calendar rows */}
            <div className="flex-1 flex flex-col">
                {weekTotals.map((week, idx) => (
                    <div
                        key={idx}
                        className="flex-1 border-b last:border-b-0 px-3 py-2 flex flex-col justify-center bg-card/50"
                    >
                        <div className="text-xs font-medium text-muted-foreground mb-1.5">
                            {week.weekLabel}
                        </div>
                        <div className="space-y-0.5">
                            <div className="flex justify-between items-baseline">
                                <span className="text-xs text-muted-foreground">Planned:</span>
                                <span className="text-sm font-semibold">{toDisplayDistance(week.plannedMeters).toFixed(1)} {distanceLabel()}</span>
                            </div>
                            {showActual && (
                                <div className="flex justify-between items-baseline">
                                    <span className="text-xs text-muted-foreground">Actual:</span>
                                    <span className="text-sm font-semibold text-primary">
                                        {week.actualMeters > 0 ? `${toDisplayDistance(week.actualMeters).toFixed(1)} ${distanceLabel()}` : '-'}
                                    </span>
                                </div>
                            )}
                        </div>
                        {garminConnected && onSendToGarmin && week.plannedMeters > 0 && (
                            <Button
                                variant="outline"
                                size="sm"
                                className="w-full mt-1.5 h-6 text-xs"
                                disabled={sendingWeek === week.weekLabel || removingWeek === week.weekLabel}
                                onClick={async () => {
                                    setSendingWeek(week.weekLabel)
                                    try {
                                        await onSendToGarmin(week.weekStart, week.weekEnd)
                                    } finally {
                                        setSendingWeek(null)
                                    }
                                }}
                            >
                                {sendingWeek === week.weekLabel ? 'Sending...' : 'Send to Garmin'}
                            </Button>
                        )}
                        {garminConnected && onRemoveFromGarmin && week.hasSyncedWorkouts && (
                            <Button
                                variant="outline"
                                size="sm"
                                className="w-full mt-1 h-6 text-xs text-destructive hover:text-destructive"
                                disabled={removingWeek === week.weekLabel || sendingWeek === week.weekLabel}
                                onClick={async () => {
                                    setRemovingWeek(week.weekLabel)
                                    try {
                                        await onRemoveFromGarmin(week.weekStart, week.weekEnd)
                                    } finally {
                                        setRemovingWeek(null)
                                    }
                                }}
                            >
                                {removingWeek === week.weekLabel ? 'Removing...' : 'Remove from Garmin'}
                            </Button>
                        )}
                    </div>
                ))}
            </div>
        </div>
    )
}
