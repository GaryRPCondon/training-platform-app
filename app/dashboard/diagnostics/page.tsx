'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Activity, CheckCircle2, XCircle, RefreshCw, AlertCircle } from 'lucide-react'

interface TestResult {
    status: 'idle' | 'loading' | 'success' | 'error'
    connected?: boolean
    displayName?: string | null
    username?: string | null
    tokenExpiresAt?: string | null
    lastSynced?: string | null
    error?: string
    timestamp?: string
}

export default function DiagnosticsPage() {
    const [garmin, setGarmin] = useState<TestResult>({ status: 'idle' })
    const [strava, setStrava] = useState<TestResult>({ status: 'idle' })

    const runTest = async (url: string, setResult: (r: TestResult) => void) => {
        setResult({ status: 'loading' })
        try {
            const res = await fetch(url)
            const data = await res.json()
            setResult({
                status: data.connected ? 'success' : 'error',
                ...data,
                timestamp: new Date().toLocaleTimeString()
            })
        } catch (error) {
            setResult({ status: 'error', error: String(error), timestamp: new Date().toLocaleTimeString() })
        }
    }

    const StatusBadge = ({ result }: { result: TestResult }) => {
        if (result.status === 'loading') return <Badge variant="outline" className="animate-pulse">Checking...</Badge>
        if (result.status === 'success') return <Badge className="bg-green-500 hover:bg-green-600">Connected</Badge>
        if (result.status === 'error') return <Badge variant="destructive">Not connected</Badge>
        return <Badge variant="outline">Unknown</Badge>
    }

    const ResultView = ({ result }: { result: TestResult }) => {
        if (result.status === 'idle') return <p className="text-sm text-muted-foreground">Press Test to check the connection.</p>

        return (
            <div className="space-y-3 mt-4">
                <div className="flex items-center gap-2">
                    {result.status === 'loading' ? (
                        <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : result.status === 'success' ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : (
                        <XCircle className="h-4 w-4 text-red-500" />
                    )}
                    <span className="text-sm font-medium">
                        {result.status === 'loading' ? 'Testing...' : result.status === 'success' ? 'API reachable' : 'Failed'}
                    </span>
                    {result.timestamp && <span className="text-xs text-muted-foreground ml-auto">{result.timestamp}</span>}
                </div>

                {result.error && (
                    <div className="p-3 bg-destructive/10 text-destructive rounded-md text-sm flex items-start gap-2">
                        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                        <span>{result.error}</span>
                    </div>
                )}

                {result.status === 'success' && (
                    <div className="text-sm space-y-1 text-muted-foreground">
                        {result.displayName && <p><span className="font-medium text-foreground">Account:</span> {result.displayName}{result.username ? ` (@${result.username})` : ''}</p>}
                        {result.lastSynced && <p><span className="font-medium text-foreground">Last synced:</span> {new Date(result.lastSynced).toLocaleString()}</p>}
                        {result.tokenExpiresAt && <p><span className="font-medium text-foreground">Token expires:</span> {new Date(result.tokenExpiresAt).toLocaleString()}</p>}
                    </div>
                )}
            </div>
        )
    }

    return (
        <div className="container mx-auto p-6 space-y-8">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Diagnostics</h1>
                <p className="text-muted-foreground">Test live connectivity to external APIs</p>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                {/* Garmin */}
                <Card>
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Activity className="h-5 w-5 text-blue-500" />
                                <CardTitle>Garmin Connect</CardTitle>
                            </div>
                            <StatusBadge result={garmin} />
                        </div>
                        <CardDescription>Direct OAuth API — fetches your Garmin profile to verify the connection</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Button
                            size="sm"
                            onClick={() => runTest('/api/diagnostics/garmin', setGarmin)}
                            disabled={garmin.status === 'loading'}
                        >
                            {garmin.status === 'loading' ? 'Testing...' : 'Test Connection'}
                        </Button>
                        <ResultView result={garmin} />
                    </CardContent>
                </Card>

                {/* Strava */}
                <Card>
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Activity className="h-5 w-5 text-orange-500" />
                                <CardTitle>Strava</CardTitle>
                            </div>
                            <StatusBadge result={strava} />
                        </div>
                        <CardDescription>OAuth2 API — fetches your Strava athlete profile to verify the connection</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Button
                            size="sm"
                            onClick={() => runTest('/api/diagnostics/strava', setStrava)}
                            disabled={strava.status === 'loading'}
                        >
                            {strava.status === 'loading' ? 'Testing...' : 'Test Connection'}
                        </Button>
                        <ResultView result={strava} />
                    </CardContent>
                </Card>
            </div>

            {/* Database Management */}
            <Card className="border-destructive/50">
                <CardHeader>
                    <div className="flex items-center gap-2">
                        <AlertCircle className="h-5 w-5 text-destructive" />
                        <CardTitle>Database Management</CardTitle>
                    </div>
                    <CardDescription>Dangerous operations — use with caution</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-md">
                        <h3 className="font-semibold text-sm mb-2">Erase All Activities</h3>
                        <p className="text-sm text-muted-foreground mb-4">
                            Permanently deletes all activities from the database. This cannot be undone.
                        </p>
                        <Button
                            variant="destructive"
                            size="sm"
                            onClick={async () => {
                                if (!confirm('Are you sure you want to delete ALL activities? This cannot be undone!')) return
                                try {
                                    const res = await fetch('/api/activities/delete-all', { method: 'DELETE' })
                                    const data = await res.json()
                                    if (data.success) alert(`Successfully deleted ${data.count} activities`)
                                    else alert(`Error: ${data.error}`)
                                } catch (error) {
                                    alert(`Error: ${error}`)
                                }
                            }}
                        >
                            Erase All Activities
                        </Button>
                    </div>

                    <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-md">
                        <h3 className="font-semibold text-sm mb-2">Erase All Plans</h3>
                        <p className="text-sm text-muted-foreground mb-4">
                            Permanently deletes all training plans, phases, weekly plans, and planned workouts. This cannot be undone.
                        </p>
                        <Button
                            variant="destructive"
                            size="sm"
                            onClick={async () => {
                                if (!confirm('Are you sure you want to delete ALL plans and workouts? This cannot be undone!')) return
                                try {
                                    const res = await fetch('/api/plans/delete-all', { method: 'DELETE' })
                                    const data = await res.json()
                                    if (data.success) alert(`Successfully deleted ${data.count} plans and all related data`)
                                    else alert(`Error: ${data.error}`)
                                } catch (error) {
                                    alert(`Error: ${error}`)
                                }
                            }}
                        >
                            Erase All Plans
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
