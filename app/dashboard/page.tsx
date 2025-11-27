import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/server'
import { PhaseProgressCard } from '@/components/progress/phase-progress-card'
import { WeeklyProgressChart } from '@/components/progress/weekly-progress-chart'

export default async function DashboardPage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) return null

    // Fetch total distance (all time)
    const { data: activities } = await supabase
        .from('activities')
        .select('distance_meters')
        .eq('athlete_id', user.id)

    const totalDistanceMeters = activities?.reduce((acc: number, curr: { distance_meters: number | null }) => acc + (curr.distance_meters || 0), 0) || 0
    const totalDistanceKm = (totalDistanceMeters / 1000).toFixed(1)

    // Fetch active plan
    const { data: activePlan } = await supabase
        .from('training_plans')
        .select('name')
        .eq('athlete_id', user.id)
        .eq('status', 'active')
        .single()

    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">
                            Total Distance
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{totalDistanceKm} km</div>
                        <p className="text-xs text-muted-foreground">
                            All time
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">
                            Active Plan
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{activePlan?.name || 'None'}</div>
                        <p className="text-xs text-muted-foreground">
                            {activePlan ? 'Keep it up!' : 'Create a plan to get started'}
                        </p>
                    </CardContent>
                </Card>
            </div>

            {/* Phase Progress */}
            <div className="grid gap-6 md:grid-cols-2">
                <PhaseProgressCard />
                <WeeklyProgressChart />
            </div>
        </div>
    )
}
