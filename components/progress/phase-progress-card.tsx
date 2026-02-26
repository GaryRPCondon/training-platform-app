'use client'

import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { TrendingUp, Calendar, Target } from 'lucide-react'
import { getCurrentAthleteId } from '@/lib/supabase/client'
import { getPhaseProgress } from '@/lib/analysis/phase-progress'
import { useUnits } from '@/lib/hooks/use-units'

export function PhaseProgressCard() {
    const { toDisplayDistance, distanceLabel } = useUnits()
    const { data: progress, isLoading } = useQuery({
        queryKey: ['phase-progress'],
        queryFn: async () => {
            const athleteId = await getCurrentAthleteId()
            return getPhaseProgress(athleteId)
        },
    })

    if (isLoading || !progress) {
        return null
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5" />
                    Training Phase Progress
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* Phase Info */}
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <div>
                            <h3 className="text-xl font-bold tracking-tight capitalize">{progress.phaseName} Phase</h3>
                            <p className="text-sm text-muted-foreground">{progress.phaseDescription}</p>
                        </div>
                        <Badge variant="outline" className="px-3 rounded-full text-xs font-semibold">
                            Week {progress.currentWeek}/{progress.totalWeeks}
                        </Badge>
                    </div>
                    <Progress value={progress.percentComplete} className="h-2.5 mt-3" />
                    <p className="text-xs font-medium text-muted-foreground mt-1.5">
                        {progress.percentComplete}% complete
                    </p>
                </div>

                {/* Weekly Volume */}
                <div>
                    <div className="flex items-center gap-2 mb-2">
                        <Target className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">This Week's Volume</span>
                    </div>
                    <div className="flex items-baseline gap-2 mb-2">
                        <span className="text-3xl font-bold">{Math.round(toDisplayDistance(progress.weeklyVolumeActual * 1000))}{distanceLabel()}</span>
                        <span className="text-sm font-medium text-muted-foreground">/ {Math.round(toDisplayDistance(progress.weeklyVolumeTarget * 1000))}{distanceLabel()}</span>
                    </div>
                    <Progress value={progress.volumePercentComplete} className="h-2.5 mt-3" />
                    <p className="text-xs font-medium text-muted-foreground mt-1.5">
                        {progress.volumePercentComplete}% of weekly target
                    </p>
                </div>

                {progress.upcomingMilestone && (
                    <div className="flex items-start gap-4 p-4 rounded-xl bg-slate-50 border border-slate-100 dark:bg-slate-900/50 dark:border-slate-800 mt-4">
                        <Calendar className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5" />
                        <div>
                            <p className="text-sm font-semibold mb-0.5 text-foreground leading-none">Next Milestone</p>
                            <p className="text-[13px] text-muted-foreground leading-tight mt-1">{progress.upcomingMilestone}</p>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
