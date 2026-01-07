'use client'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { GarminConnect } from './garmin-connect'

interface ConnectionsCardProps {
    stravaConnected: boolean
    garminConnected: boolean
    onRefresh?: () => void
}

export function ConnectionsCard({ stravaConnected, garminConnected, onRefresh }: ConnectionsCardProps) {
    const router = useRouter()
    const [loading, setLoading] = useState<string | null>(null)

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
                {/* Strava */}
                <div className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center gap-4">
                        <div className="bg-[#FC4C02] text-white p-2 rounded w-10 h-10 flex items-center justify-center">
                            <span className="font-bold">S</span>
                        </div>
                        <div>
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

                {/* Garmin */}
                <GarminConnect
                    isConnected={garminConnected}
                    onConnectionChange={handleConnectionChange}
                />
            </CardContent>
        </Card>
    )
}
