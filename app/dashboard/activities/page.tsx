import { createClient } from '@/lib/supabase/server'
import { ActivitiesView } from './activities-view'

interface ActivitiesPageProps {
    searchParams: Promise<{ year?: string }>
}

export default async function ActivitiesPage({ searchParams }: ActivitiesPageProps) {
    const params = await searchParams
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) return null

    // Find athlete by ID first, then by email (same as sync routes)
    let { data: athlete } = await supabase
        .from('athletes')
        .select('id')
        .eq('id', user.id)
        .single()

    if (!athlete) {
        const { data: athleteByEmail } = await supabase
            .from('athletes')
            .select('id')
            .eq('email', user.email)
            .single()
        athlete = athleteByEmail
    }

    if (!athlete) return null

    const athleteId = athlete.id
    const currentYear = new Date().getFullYear()
    const selectedYear = params.year ? parseInt(params.year, 10) : currentYear

    // Fetch oldest activity to determine available years
    const { data: oldest } = await supabase
        .from('activities')
        .select('start_time')
        .eq('athlete_id', athleteId)
        .order('start_time', { ascending: true })
        .limit(1)
        .single()

    const oldestYear = oldest?.start_time
        ? new Date(oldest.start_time).getFullYear()
        : currentYear

    const availableYears: number[] = []
    for (let y = currentYear; y >= oldestYear; y--) {
        availableYears.push(y)
    }

    // Fetch activities filtered by selected year (server-side)
    const yearStart = `${selectedYear}-01-01T00:00:00`
    const yearEnd = `${selectedYear + 1}-01-01T00:00:00`

    const { data: activities, error } = await supabase
        .from('activities')
        .select('id, activity_name, activity_type, start_time, distance_meters, duration_seconds, source, garmin_id, strava_id')
        .eq('athlete_id', athleteId)
        .gte('start_time', yearStart)
        .lt('start_time', yearEnd)
        .order('start_time', { ascending: false })

    if (error) {
        console.error('Error fetching activities:', error)
        return (
            <div className="space-y-6">
                <h1 className="text-3xl font-bold tracking-tight">Activities</h1>
                <div className="text-center py-8 text-red-500">
                    Failed to load activities. Please try again later.
                </div>
            </div>
        )
    }

    return (
        <ActivitiesView
            initialActivities={activities || []}
            selectedYear={selectedYear}
            availableYears={availableYears}
        />
    )
}
