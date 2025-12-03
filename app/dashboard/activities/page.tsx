import { createClient } from '@/lib/supabase/server'
import { ActivitiesView } from './activities-view'

export default async function ActivitiesPage() {
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

    // Fetch all activities for this athlete
    const { data: activities, error } = await supabase
        .from('activities')
        .select('id, activity_name, activity_type, start_time, distance_meters, duration_seconds, source, garmin_id, strava_id')
        .eq('athlete_id', athleteId)
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

    return <ActivitiesView initialActivities={activities || []} />
}
