'use client'

import { useQuery } from '@tanstack/react-query'
import { getAthleteProfile } from '@/lib/supabase/queries'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { AISettingsCard } from '@/components/settings/ai-settings-card'
import { ConnectionsCard } from '@/components/settings/connections-card'
import { PreferencesCard } from '@/components/settings/preferences-card'

export default function ProfilePage() {
    const { data: athlete, isLoading, error } = useQuery({
        queryKey: ['athlete'],
        queryFn: getAthleteProfile,
    })

    if (isLoading) {
        return <ProfileSkeleton />
    }

    if (error) {
        return <div>Error loading profile</div>
    }

    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-bold tracking-tight">Profile</h1>

            <div className="grid gap-6 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>Personal Information</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div>
                            <div className="text-sm font-medium text-muted-foreground">Name</div>
                            <div className="text-lg">{athlete?.name || 'Not set'}</div>
                        </div>
                        <div>
                            <div className="text-sm font-medium text-muted-foreground">Email</div>
                            <div className="text-lg">{athlete?.email}</div>
                        </div>
                    </CardContent>
                </Card>

                <PreferencesCard />
                <AISettingsCard />
                <ConnectionsCard
                    stravaConnected={!!athlete?.strava_connected}
                    garminConnected={!!athlete?.garmin_connected}
                />
            </div>
        </div>
    )
}

function ProfileSkeleton() {
    return (
        <div className="space-y-6">
            <Skeleton className="h-10 w-32" />
            <div className="grid gap-6 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <Skeleton className="h-6 w-40" />
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <Skeleton className="h-12 w-full" />
                        <Skeleton className="h-12 w-full" />
                        <Skeleton className="h-12 w-full" />
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
