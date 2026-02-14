import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/server'
import { PhaseProgressCard } from '@/components/progress/phase-progress-card'
import { WeeklyProgressChart } from '@/components/progress/weekly-progress-chart'
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

    // Fetch total distance (all time)
    const { data: activities } = await supabase
        .from('activities')
        .select('distance_meters')
        .eq('athlete_id', athleteId)  // Use athleteId instead of user.id

    const totalDistanceMeters = activities?.reduce((acc: number, curr: { distance_meters: number | null }) => acc + (curr.distance_meters || 0), 0) || 0
    const totalDistanceDisplay = toDisplayDistance(totalDistanceMeters, units).toFixed(1)
    const distUnit = distanceLabel(units)

    // Fetch active plan (also use athleteId)
    const { data: activePlan } = await supabase
        .from('training_plans')
        .select('name')
        .eq('athlete_id', athleteId)  // Use athleteId here too
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
                        <div className="text-2xl font-bold">{totalDistanceDisplay} {distUnit}</div>
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
