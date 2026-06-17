'use client'

import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BarChart } from 'lucide-react'
import { getCurrentAthleteId } from '@/lib/supabase/client'
import { getWeeklyProgress } from '@/lib/analysis/phase-progress'
import { cn } from '@/lib/utils'
import { useUnits } from '@/lib/hooks/use-units'
import { useTranslations } from 'next-intl'

export function WeeklyProgressChart() {
    const t = useTranslations('weeklyChart')
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
                    {t('title')}
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="flex items-end justify-between gap-2 pt-4" style={{ height: '140px' }}>
                    {weeklyData.map((day) => {
                        const plannedHeight = (day.plannedDistance / maxDistance) * 100
                        const actualHeight = (day.actualDistance / maxDistance) * 100
                        const statusGlyph = day.status === 'completed' ? '✓' : day.status === 'missed' ? '✗' : ''
                        const plannedDisplay = `${Math.round(toDisplayDistance(day.plannedDistance * 1000))}${distanceLabel()}`
                        const actualDisplay = `${Math.round(toDisplayDistance(day.actualDistance * 1000))}${distanceLabel()}`

                        return (
                            <div key={day.date} className="flex flex-col items-center gap-2 flex-1 min-w-0" style={{ height: '100%' }}>
                                <span className="sr-only">
                                    {day.status === 'missed'
                                        ? t('srMissed', { day: day.dayName, planned: plannedDisplay })
                                        : t('srCompleted', { day: day.dayName, planned: plannedDisplay, actual: actualDisplay })}
                                </span>
                                <div className="relative w-full flex justify-center items-end" style={{ height: '110px' }} aria-hidden="true">
                                    {/* Planned Bar (Background) - More visible with pattern */}
                                    {day.plannedDistance > 0 && (
                                        <div
                                            className="absolute bottom-0 left-1/2 -translate-x-1/2 bg-blue-100/50 dark:bg-blue-900/30 rounded-t-full border border-blue-200 dark:border-blue-800 border-dashed"
                                            style={{
                                                width: '24px',
                                                height: `${Math.max(plannedHeight, 2)}%`,
                                                minHeight: '2px'
                                            }}
                                            title={t('plannedTitle', { value: plannedDisplay })}
                                        />
                                    )}
                                    {/* Actual Bar (Foreground) - Soft Gradients */}
                                    {day.actualDistance > 0 && (
                                        <div
                                            className={cn(
                                                "absolute bottom-0 left-1/2 -translate-x-1/2 rounded-t-full transition-all shadow-sm",
                                                day.status === 'completed' ? "bg-gradient-to-t from-emerald-500 to-emerald-300" :
                                                    day.status === 'missed' ? "bg-gradient-to-t from-rose-500 to-rose-300" : "bg-gradient-to-t from-gray-400 to-gray-300"
                                            )}
                                            style={{
                                                width: '24px',
                                                height: `${Math.max(actualHeight, 2)}%`,
                                                minHeight: '2px'
                                            }}
                                            title={t('actualTitle', { value: actualDisplay })}
                                        >
                                            <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] font-medium whitespace-nowrap">
                                                {Math.round(toDisplayDistance(day.actualDistance * 1000))}
                                            </span>
                                        </div>
                                    )}
                                </div>
                                <span className="text-xs text-muted-foreground font-medium" aria-hidden="true">
                                    {statusGlyph && (
                                        <span className={cn(
                                            "me-0.5",
                                            day.status === 'completed' ? "text-emerald-500" : "text-rose-500"
                                        )}>{statusGlyph}</span>
                                    )}
                                    {day.dayName}
                                </span>
                            </div>
                        )
                    })}
                </div>
                <div className="flex justify-center gap-6 mt-6 text-xs text-muted-foreground font-medium">
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 bg-gradient-to-t from-emerald-500 to-emerald-300 rounded-full shadow-sm" />
                        <span>{t('completed')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 bg-blue-100/50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 border-dashed rounded-full" />
                        <span>{t('planned')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 bg-gradient-to-t from-rose-500 to-rose-300 rounded-full shadow-sm" />
                        <span>{t('missed')}</span>
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}
