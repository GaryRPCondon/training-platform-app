import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/server'
import { PhaseProgressCard } from '@/components/progress/phase-progress-card'
import { WeeklyProgressChart } from '@/components/progress/weekly-progress-chart'
import { TodaysWorkoutCard } from '@/components/progress/todays-workout-card'
import { toDisplayDistance, distanceLabel, type UnitSystem } from '@/lib/utils/units'

export default async function DashboardPage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) return null

    // Find athlete by ID first, then by email (same as sync routes)
    let { data: athlete } = await supabase
        .from('athletes')
        .select('id, preferred_units')
        .eq('id', user.id)
        .single()

    if (!athlete) {
        const { data: athleteByEmail } = await supabase
            .from('athletes')
            .select('id, preferred_units')
            .eq('email', user.email)
            .single()
        athlete = athleteByEmail
    }

    if (!athlete) return null

    const athleteId = athlete.id
    const units: UnitSystem = (athlete.preferred_units as UnitSystem) || 'metric'

    const distUnit = distanceLabel(units)

    // Fetch active plan first (need start_date for stats RPC)
    const { data: activePlan } = await supabase
        .from('training_plans')
        .select('name, start_date, end_date')
        .eq('athlete_id', athleteId)
        .eq('status', 'active')
        .single()

    // Fetch all dashboard stats in a single SQL query (no row transfer)
    const yearStart = `${new Date().getFullYear()}-01-01`
    const { data: stats } = await supabase.rpc('get_dashboard_stats', {
        p_athlete_id: athleteId,
        p_year_start: yearStart,
        p_plan_start: activePlan?.start_date || null,
    })

    const totalDistanceMeters = stats?.total_distance ?? 0
    const totalDistanceDisplay = toDisplayDistance(totalDistanceMeters, units).toFixed(1)
    const totalActivities = stats?.total_count ?? 0
    const distanceThisYearMeters = stats?.year_distance ?? 0
    const climbThisYearMeters = stats?.year_climb ?? 0
    const planDistanceMeters = stats?.plan_distance ?? 0

    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
            <div className="grid gap-6 md:grid-cols-2">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                            Total Distance
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div>
                            <div className="text-4xl font-bold tracking-tight">{totalDistanceDisplay} <span className="text-2xl text-muted-foreground">{distUnit}</span></div>
                            <p className="text-sm text-muted-foreground mt-1">
                                {totalActivities} activities tracked
                            </p>
                        </div>
                        <div className="space-y-2 text-sm">
                            {activePlan && (
                                <div>
                                    <p className="text-muted-foreground text-xs">Plan Distance</p>
                                    <p className="font-semibold">{toDisplayDistance(planDistanceMeters, units).toFixed(1)} {distUnit}</p>
                                </div>
                            )}
                            <div>
                                <p className="text-muted-foreground text-xs">This Year</p>
                                <p className="font-semibold">{toDisplayDistance(distanceThisYearMeters, units).toFixed(1)} {distUnit}</p>
                            </div>
                            <div>
                                <p className="text-muted-foreground text-xs">Climb This Year</p>
                                <p className="font-semibold">{Math.round(climbThisYearMeters).toLocaleString()} m</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <div className="flex flex-col gap-6">
                    <Card className="flex flex-col justify-center">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">
                                Active Plan
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl sm:text-3xl font-bold tracking-tight truncate">{activePlan?.name || 'None'}</div>
                            <p className="text-sm text-muted-foreground mt-1">
                                {activePlan
                                    ? `${new Date(activePlan.start_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(activePlan.end_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                                    : 'Create a plan to get started'}
                            </p>
                        </CardContent>
                    </Card>
                    <TodaysWorkoutCard />
                </div>
            </div>

            {/* Phase Progress */}
            <div className="grid gap-6 md:grid-cols-2">
                <PhaseProgressCard />
                <WeeklyProgressChart />
            </div>
        </div>
    )
}
