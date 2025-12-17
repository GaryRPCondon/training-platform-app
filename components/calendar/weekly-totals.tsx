'use client'

import { useMemo } from 'react'
import { startOfWeek, endOfWeek, format, eachWeekOfInterval, startOfMonth, endOfMonth, addDays, subDays } from 'date-fns'

interface WeeklyTotalsProps {
    workouts: any[]
    currentDate: Date
    view: 'month' | 'week' | 'day'
    weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6
    showActual?: boolean
}

interface WeekTotal {
    weekLabel: string
    weekStart: Date
    weekEnd: Date
    plannedKm: number
    actualKm: number
}

export function WeeklyTotals({ workouts, currentDate, view, weekStartsOn, showActual = false }: WeeklyTotalsProps) {
    const weekTotals = useMemo(() => {
        // Determine the date range to show based on view
        let rangeStart: Date
        let rangeEnd: Date

        if (view === 'month') {
            // For month view, show weeks that overlap with the month
            const monthStart = startOfMonth(currentDate)
            const monthEnd = endOfMonth(currentDate)

            // Match React Big Calendar logic:
            // Start: Start of the week containing the 1st of the month
            // End: End of the week containing the last day of the month
            rangeStart = startOfWeek(monthStart, { weekStartsOn })
            rangeEnd = endOfWeek(monthEnd, { weekStartsOn })
        } else if (view === 'week') {
            // For week view, just show the current week
            rangeStart = startOfWeek(currentDate, { weekStartsOn })
            rangeEnd = endOfWeek(currentDate, { weekStartsOn })
        } else {
            // For day view, show the week containing the day
            rangeStart = startOfWeek(currentDate, { weekStartsOn })
            rangeEnd = endOfWeek(currentDate, { weekStartsOn })
        }

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
                const workoutDate = new Date(w.scheduled_date || w.date)
                return workoutDate >= weekStart && workoutDate <= weekEnd
            })

            // Calculate planned distance
            const plannedMeters = weekWorkouts.reduce((sum, w) => {
                return sum + (w.distance_target_meters || 0)
            }, 0)

            // Calculate actual distance (from completed activities)
            const actualMeters = weekWorkouts.reduce((sum, w) => {
                // Check if workout has a completed activity with distance
                if (w.completed_activity_id && w.activity_distance_meters) {
                    return sum + w.activity_distance_meters
                }
                return sum
            }, 0)

            // Format week label
            const weekLabel = `${format(weekStart, 'd')} - ${format(weekEnd, 'd MMM')}`

            return {
                weekLabel,
                weekStart,
                weekEnd,
                plannedKm: plannedMeters / 1000,
                actualKm: actualMeters / 1000
            }
        })
    }, [workouts, currentDate, view, weekStartsOn])

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
                                <span className="text-sm font-semibold">{week.plannedKm.toFixed(1)} km</span>
                            </div>
                            {showActual && (
                                <div className="flex justify-between items-baseline">
                                    <span className="text-xs text-muted-foreground">Actual:</span>
                                    <span className="text-sm font-semibold text-primary">
                                        {week.actualKm > 0 ? `${week.actualKm.toFixed(1)} km` : '-'}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
