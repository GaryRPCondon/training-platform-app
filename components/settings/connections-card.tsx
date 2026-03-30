'use client'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CheckCircle2, XCircle, Loader2, Wifi } from 'lucide-react'
import { GarminConnect } from './garmin-connect'
import { getAthleteProfile } from '@/lib/supabase/queries'

interface ConnectionsCardProps {
    stravaConnected: boolean
    garminConnected: boolean
    onRefresh?: () => void
}

interface TestResult {
    status: 'idle' | 'loading' | 'success' | 'error'
    message?: string
}

export function ConnectionsCard({ stravaConnected, garminConnected, onRefresh }: ConnectionsCardProps) {
    const router = useRouter()
    const queryClient = useQueryClient()
    const [loading, setLoading] = useState<string | null>(null)
    const [stravaTest, setStravaTest] = useState<TestResult>({ status: 'idle' })

    const testStravaConnection = async () => {
        setStravaTest({ status: 'loading' })
        try {
            const res = await fetch('/api/connections/test/strava')
            const data = await res.json()
            if (data.connected) {
                setStravaTest({ status: 'success', message: data.displayName ? `Connected as ${data.displayName}` : 'Connected' })
            } else {
                setStravaTest({ status: 'error', message: data.error || 'Connection failed' })
            }
        } catch {
            setStravaTest({ status: 'error', message: 'Connection test failed' })
        }
    }

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

    // Mutation to update sync_on_login
    const updateSyncOnLoginMutation = useMutation({
        mutationFn: async (sync_on_login: boolean) => {
            const response = await fetch('/api/settings/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sync_on_login })
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
            updatePreferenceMutation.mutate('most_recent')
        }
    }

    // Handler for Garmin preference toggle
    const handleGarminPreferenceChange = (checked: boolean) => {
        if (checked) {
            updatePreferenceMutation.mutate('garmin')
            toast.success('Garmin data will be prioritized')
        } else {
            updatePreferenceMutation.mutate('most_recent')
        }
    }

    // Determine which source is preferred
    const stravaPreferred = stravaConnected && !garminConnected
        ? true
        : athlete?.preferred_activity_data_source === 'strava'
    const garminPreferred = garminConnected && !stravaConnected
        ? true
        : athlete?.preferred_activity_data_source === 'garmin'

    const handleConnectionChange = () => {
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
            alert('Disconnect functionality coming in next step')
        } catch (error) {
            console.error('Failed to disconnect', error)
        }
    }

    const handleSyncOnLoginChange = (checked: boolean) => {
        updateSyncOnLoginMutation.mutate(checked)
        toast.success(checked ? 'Activities will sync on login' : 'Auto-sync disabled')
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Integrations</CardTitle>
                <CardDescription>Connect your fitness accounts</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Sync on login toggle - only show when at least one integration connected */}
                {(garminConnected || stravaConnected) && (
                    <div className="flex items-center justify-between p-3 sm:p-4 border rounded-lg">
                        <div>
                            <Label htmlFor="sync-on-login" className="cursor-pointer">
                                Sync activities on login
                            </Label>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                Automatically sync the last 7 days when you open the dashboard
                            </p>
                        </div>
                        <Switch
                            id="sync-on-login"
                            checked={athlete?.sync_on_login ?? false}
                            onCheckedChange={handleSyncOnLoginChange}
                            disabled={updateSyncOnLoginMutation.isPending}
                        />
                    </div>
                )}

                {/* Garmin */}
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
                        <div className="flex items-center gap-2">
                            {stravaConnected ? (
                                <>
                                    {stravaTest.status === 'success' ? (
                                        <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                                            <CheckCircle2 className="h-3 w-3" /> Connected
                                        </span>
                                    ) : stravaTest.status === 'error' ? (
                                        <span className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
                                            <XCircle className="h-3 w-3" /> {stravaTest.message}
                                        </span>
                                    ) : (
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            className="h-7 text-xs"
                                            onClick={testStravaConnection}
                                            disabled={stravaTest.status === 'loading'}
                                        >
                                            {stravaTest.status === 'loading' ? (
                                                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                            ) : (
                                                <Wifi className="mr-1 h-3 w-3" />
                                            )}
                                            Test
                                        </Button>
                                    )}
                                    <Button variant="outline" size="sm" onClick={handleDisconnectStrava}>
                                        Disconnect
                                    </Button>
                                </>
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

                    {/* Strava Data Priority Toggle */}
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
