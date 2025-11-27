'use client'

import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BarChart } from 'lucide-react'
import { getCurrentAthleteId } from '@/lib/supabase/client'
import { getWeeklyProgress } from '@/lib/analysis/phase-progress'
import { cn } from '@/lib/utils'

export function WeeklyProgressChart() {
    const { data: weeklyData, isLoading } = useQuery({
        queryKey: ['weekly-progress'],
        queryFn: () => getWeeklyProgress(getCurrentAthleteId()),
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
                <div className="flex items-end justify-between gap-2 h-48 pt-4">
                    {weeklyData.map((day) => (
                        <div key={day.date} className="flex flex-col items-center gap-2 flex-1">
                            <div className="relative w-full flex justify-center items-end h-full gap-1">
                                {/* Planned Bar (Background/Ghost) */}
                                {day.plannedDistance > 0 && (
                                    <div
                                        className="absolute bottom-0 w-full max-w-[24px] bg-muted rounded-t-sm"
                                        style={{ height: `${(day.plannedDistance / maxDistance) * 100}%` }}
                                        title={`Planned: ${day.plannedDistance}km`}
                                    />
                                )}
                                {/* Actual Bar (Foreground) */}
                                <div
                                    className={cn(
                                        "relative w-full max-w-[24px] rounded-t-sm transition-all",
                                        day.status === 'completed' ? "bg-primary" :
                                            day.status === 'missed' ? "bg-destructive/50" : "bg-transparent"
                                    )}
                                    style={{ height: `${(day.actualDistance / maxDistance) * 100}%` }}
                                    title={`Actual: ${day.actualDistance}km`}
                                >
                                    {day.actualDistance > 0 && (
                                        <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] font-medium">
                                            {day.actualDistance}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <span className="text-xs text-muted-foreground font-medium">
                                {day.dayName}
                            </span>
                        </div>
                    ))}
                </div>
                <div className="flex justify-center gap-4 mt-4 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                        <div className="w-3 h-3 bg-primary rounded-sm" />
                        <span>Completed</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <div className="w-3 h-3 bg-muted rounded-sm" />
                        <span>Planned</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <div className="w-3 h-3 bg-destructive/50 rounded-sm" />
                        <span>Missed</span>
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}
