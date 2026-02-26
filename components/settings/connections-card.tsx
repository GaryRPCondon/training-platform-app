'use client'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { GarminConnect } from './garmin-connect'
import { getAthleteProfile } from '@/lib/supabase/queries'

interface ConnectionsCardProps {
    stravaConnected: boolean
    garminConnected: boolean
    onRefresh?: () => void
}

export function ConnectionsCard({ stravaConnected, garminConnected, onRefresh }: ConnectionsCardProps) {
    const router = useRouter()
    const queryClient = useQueryClient()
    const [loading, setLoading] = useState<string | null>(null)

    // Fetch current athlete profile for data source preference
    const { data: athlete, refetch } = useQuery({
        queryKey: ['athlete'],
        queryFn: getAthleteProfile
    })

    // Mutation to update data source preference
    const updatePreferenceMutation = useMutation({
        mutationFn: async (dataSource: 'strava' | 'garmin' | 'most_recent') => {
            const response = await fetch('/api/settings/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ preferred_activity_data_source: dataSource })
            })
            if (!response.ok) throw new Error('Failed to update preference')
            return response.json()
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['athlete'] })
            await refetch()
        },
        onError: () => {
            toast.error('Failed to update preference')
        }
    })

    // Handler for Strava preference toggle
    const handleStravaPreferenceChange = (checked: boolean) => {
        if (checked) {
            updatePreferenceMutation.mutate('strava')
            toast.success('Strava data will be prioritized')
        } else {
            // If unchecked, default to most_recent
            updatePreferenceMutation.mutate('most_recent')
        }
    }

    // Handler for Garmin preference toggle
    const handleGarminPreferenceChange = (checked: boolean) => {
        if (checked) {
            updatePreferenceMutation.mutate('garmin')
            toast.success('Garmin data will be prioritized')
        } else {
            // If unchecked, default to most_recent
            updatePreferenceMutation.mutate('most_recent')
        }
    }

    // Determine which source is preferred
    // If only one is connected, it should be automatically preferred
    const stravaPreferred = stravaConnected && !garminConnected
        ? true
        : athlete?.preferred_activity_data_source === 'strava'
    const garminPreferred = garminConnected && !stravaConnected
        ? true
        : athlete?.preferred_activity_data_source === 'garmin'

    const handleConnectionChange = () => {
        // Refresh the parent component to get updated connection status
        if (onRefresh) {
            onRefresh()
        } else {
            router.refresh()
        }
    }

    const handleConnectStrava = () => {
        setLoading('strava')
        router.push('/api/strava/auth')
    }

    const handleDisconnectStrava = async () => {
        if (!confirm('Are you sure you want to disconnect Strava?')) return

        try {
            // For now just redirect to a disconnect route we haven't built yet,
            // or just show alert as per plan we are focusing on Auth first.
            // But let's be proactive and create the route later.
            alert('Disconnect functionality coming in next step')
        } catch (error) {
            console.error('Failed to disconnect', error)
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Integrations</CardTitle>
                <CardDescription>Connect your fitness accounts</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Garmin - Now on top */}
                <GarminConnect
                    isConnected={garminConnected}
                    onConnectionChange={handleConnectionChange}
                    stravaConnected={stravaConnected}
                    garminPreferred={garminPreferred}
                    stravaPreferred={stravaPreferred}
                    onPreferenceChange={handleGarminPreferenceChange}
                />

                {/* Strava */}
                <div className="p-3 sm:p-4 border rounded-lg space-y-3">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
                            <div className="bg-[#FC4C02] text-white p-2 rounded w-10 h-10 flex items-center justify-center shrink-0">
                                <span className="font-bold">S</span>
                            </div>
                            <div className="min-w-0">
                                <div className="font-medium">Strava</div>
                                <div className="text-sm text-muted-foreground">
                                    {stravaConnected ? 'Connected' : 'Not connected'}
                                </div>
                            </div>
                        </div>
                        <div>
                            {stravaConnected ? (
                                <Button variant="outline" size="sm" onClick={handleDisconnectStrava}>
                                    Disconnect
                                </Button>
                            ) : (
                                <Button
                                    size="sm"
                                    onClick={handleConnectStrava}
                                    disabled={loading === 'strava'}
                                    className="bg-[#FC4C02] hover:bg-[#E34402] text-white"
                                >
                                    {loading === 'strava' ? 'Connecting...' : 'Connect'}
                                </Button>
                            )}
                        </div>
                    </div>

                    {/* Strava Data Priority Toggle - Always show if at least one integration exists */}
                    {(stravaConnected || garminConnected) && (
                        <div className="flex items-center justify-between pt-2 border-t">
                            <Label htmlFor="strava-prefer" className="text-sm text-muted-foreground cursor-pointer">
                                Prefer data from this source
                            </Label>
                            <Switch
                                id="strava-prefer"
                                checked={stravaPreferred}
                                onCheckedChange={handleStravaPreferenceChange}
                                disabled={!stravaConnected}
                            />
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    )
}
