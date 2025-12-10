'use client'

import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { getAthleteProfile } from '@/lib/supabase/queries'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AISettingsCard } from '@/components/settings/ai-settings-card'
import { ConnectionsCard } from '@/components/settings/connections-card'
import { PreferencesCard } from '@/components/settings/preferences-card'
import { LogOut } from 'lucide-react'
import { toast } from 'sonner'

export default function ProfilePage() {
    const router = useRouter()
    const { data: athlete, isLoading, error } = useQuery({
        queryKey: ['athlete'],
        queryFn: getAthleteProfile,
    })

    async function handleLogout() {
        try {
            const response = await fetch('/api/auth/logout', {
                method: 'POST'
            })

            if (!response.ok) {
                throw new Error('Logout failed')
            }

            toast.success('Logged out successfully')
            router.push('/login')
            router.refresh()
        } catch (error) {
            console.error('Error logging out:', error)
            toast.error('Failed to log out')
        }
    }

    if (isLoading) {
        return <ProfileSkeleton />
    }

    if (error) {
        return <div>Error loading profile</div>
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold tracking-tight">Profile</h1>
                <Button
                    variant="outline"
                    onClick={handleLogout}
                    className="gap-2"
                >
                    <LogOut className="h-4 w-4" />
                    Logout
                </Button>
            </div>

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
