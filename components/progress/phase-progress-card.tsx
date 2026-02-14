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
                            <h3 className="text-lg font-semibold">{progress.phaseName} Phase</h3>
                            <p className="text-sm text-muted-foreground">{progress.phaseDescription}</p>
                        </div>
                        <Badge variant="outline">
                            Week {progress.currentWeek}/{progress.totalWeeks}
                        </Badge>
                    </div>
                    <Progress value={progress.percentComplete} className="h-2" />
                    <p className="text-xs text-muted-foreground mt-1">
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
                        <span className="text-2xl font-bold">{Math.round(toDisplayDistance(progress.weeklyVolumeActual * 1000))}{distanceLabel()}</span>
                        <span className="text-sm text-muted-foreground">/ {Math.round(toDisplayDistance(progress.weeklyVolumeTarget * 1000))}{distanceLabel()}</span>
                    </div>
                    <Progress value={progress.volumePercentComplete} className="h-2" />
                    <p className="text-xs text-muted-foreground mt-1">
                        {progress.volumePercentComplete}% of weekly target
                    </p>
                </div>

                {/* Upcoming Milestone */}
                {progress.upcomingMilestone && (
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50">
                        <Calendar className="h-4 w-4 text-muted-foreground mt-0.5" />
                        <div>
                            <p className="text-xs font-medium">Next Milestone</p>
                            <p className="text-sm text-muted-foreground">{progress.upcomingMilestone}</p>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
