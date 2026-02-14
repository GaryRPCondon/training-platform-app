'use client'

import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BarChart } from 'lucide-react'
import { getCurrentAthleteId } from '@/lib/supabase/client'
import { getWeeklyProgress } from '@/lib/analysis/phase-progress'
import { cn } from '@/lib/utils'
import { useUnits } from '@/lib/hooks/use-units'

export function WeeklyProgressChart() {
    const { toDisplayDistance, distanceLabel } = useUnits()
    const { data: weeklyData, isLoading } = useQuery({
        queryKey: ['weekly-progress'],
        queryFn: async () => {
            const athleteId = await getCurrentAthleteId()
            return getWeeklyProgress(athleteId)
        },
    })

    if (isLoading || !weeklyData) return null

    const maxDistance = Math.max(
        ...weeklyData.map(d => Math.max(d.plannedDistance, d.actualDistance)),
        10 // Minimum scale
    )

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <BarChart className="h-5 w-5" />
                    Weekly Breakdown
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="flex items-end justify-between gap-2 pt-4" style={{ height: '192px' }}>
                    {weeklyData.map((day) => {
                        const plannedHeight = (day.plannedDistance / maxDistance) * 100
                        const actualHeight = (day.actualDistance / maxDistance) * 100

                        return (
                            <div key={day.date} className="flex flex-col items-center gap-2 flex-1 min-w-0" style={{ height: '100%' }}>
                                <div className="relative w-full flex justify-center items-end" style={{ height: '160px' }}>
                                    {/* Planned Bar (Background) - More visible with pattern */}
                                    {day.plannedDistance > 0 && (
                                        <div
                                            className="absolute bottom-0 left-1/2 -translate-x-1/2 bg-blue-100 dark:bg-blue-950 rounded-t-sm border-2 border-blue-300 dark:border-blue-800 border-dashed"
                                            style={{
                                                width: '24px',
                                                height: `${Math.max(plannedHeight, 2)}%`,
                                                minHeight: '2px'
                                            }}
                                            title={`Planned: ${Math.round(toDisplayDistance(day.plannedDistance * 1000))}${distanceLabel()}`}
                                        />
                                    )}
                                    {/* Actual Bar (Foreground) - Solid colors */}
                                    {day.actualDistance > 0 && (
                                        <div
                                            className={cn(
                                                "absolute bottom-0 left-1/2 -translate-x-1/2 rounded-t-sm transition-all border-2",
                                                day.status === 'completed' ? "bg-green-500 border-green-600" :
                                                    day.status === 'missed' ? "bg-red-400 border-red-500" : "bg-gray-400 border-gray-500"
                                            )}
                                            style={{
                                                width: '24px',
                                                height: `${Math.max(actualHeight, 2)}%`,
                                                minHeight: '2px'
                                            }}
                                            title={`Actual: ${Math.round(toDisplayDistance(day.actualDistance * 1000))}${distanceLabel()}`}
                                        >
                                            <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] font-medium whitespace-nowrap">
                                                {Math.round(toDisplayDistance(day.actualDistance * 1000))}
                                            </span>
                                        </div>
                                    )}
                                </div>
                                <span className="text-xs text-muted-foreground font-medium">
                                    {day.dayName}
                                </span>
                            </div>
                        )
                    })}
                </div>
                <div className="flex justify-center gap-4 mt-4 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                        <div className="w-3 h-3 bg-green-500 border-2 border-green-600 rounded-sm" />
                        <span>Completed</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <div className="w-3 h-3 bg-blue-100 dark:bg-blue-950 border-2 border-blue-300 dark:border-blue-800 border-dashed rounded-sm" />
                        <span>Planned</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <div className="w-3 h-3 bg-red-400 border-2 border-red-500 rounded-sm" />
                        <span>Missed</span>
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}
