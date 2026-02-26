'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Activity, CheckCircle2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

interface SyncResult {
    success: boolean
    synced?: number
    merged?: number
    pendingReview?: number
    error?: string
}

export default function SyncTestPage() {
    if (process.env.NODE_ENV === 'production') return null
    const [garminResult, setGarminResult] = useState<SyncResult | null>(null)
    const [stravaResult, setStravaResult] = useState<SyncResult | null>(null)
    const [garminLoading, setGarminLoading] = useState(false)
    const [stravaLoading, setStravaLoading] = useState(false)

    const syncGarmin = async () => {
        setGarminLoading(true)
        setGarminResult(null)
        try {
            const res = await fetch('/api/sync/garmin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            })
            const data = await res.json()
            setGarminResult(data)
            if (data.success) {
                toast.success(`Garmin sync complete: ${data.synced} activities`)
            } else {
                toast.error(data.error || 'Sync failed')
            }
        } catch (error) {
            setGarminResult({ success: false, error: String(error) })
            toast.error('Sync failed')
        } finally {
            setGarminLoading(false)
        }
    }

    const syncStrava = async () => {
        setStravaLoading(true)
        setStravaResult(null)
        try {
            const res = await fetch('/api/sync/strava', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            })
            const data = await res.json()
            setStravaResult(data)
            if (data.success) {
                toast.success(`Strava sync complete: ${data.synced} activities`)
            } else {
                toast.error(data.error || 'Sync failed')
            }
        } catch (error) {
            setStravaResult({ success: false, error: String(error) })
            toast.error('Sync failed')
        } finally {
            setStravaLoading(false)
        }
    }

    return (
        <div className="container mx-auto p-6 space-y-8">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Activity Sync Test</h1>
                <p className="text-muted-foreground">Test syncing activities from Garmin and Strava bridges</p>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                {/* Garmin Sync */}
                <Card>
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Activity className="h-5 w-5 text-blue-500" />
                                <CardTitle>Garmin Sync</CardTitle>
                            </div>
                            {garminResult?.success && (
                                <Badge className="bg-green-500">Success</Badge>
                            )}
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <Button
                            onClick={syncGarmin}
                            disabled={garminLoading}
                            className="w-full"
                        >
                            {garminLoading ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Syncing...
                                </>
                            ) : (
                                'Sync from Garmin'
                            )}
                        </Button>

                        {garminResult && (
                            <div className="space-y-2 p-4 bg-muted rounded-lg">
                                {garminResult.success ? (
                                    <>
                                        <div className="flex items-center gap-2 text-sm">
                                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                                            <span className="font-medium">Sync Complete</span>
                                        </div>
                                        <div className="grid grid-cols-3 gap-2 text-sm mt-3">
                                            <div>
                                                <div className="text-muted-foreground">Synced</div>
                                                <div className="text-lg font-bold">{garminResult.synced || 0}</div>
                                            </div>
                                            <div>
                                                <div className="text-muted-foreground">Merged</div>
                                                <div className="text-lg font-bold">{garminResult.merged || 0}</div>
                                            </div>
                                            <div>
                                                <div className="text-muted-foreground">Review</div>
                                                <div className="text-lg font-bold">{garminResult.pendingReview || 0}</div>
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <div className="text-sm text-destructive">
                                        Error: {garminResult.error || 'Unknown error'}
                                    </div>
                                )}
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Strava Sync */}
                <Card>
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Activity className="h-5 w-5 text-orange-500" />
                                <CardTitle>Strava Sync</CardTitle>
                            </div>
                            {stravaResult?.success && (
                                <Badge className="bg-green-500">Success</Badge>
                            )}
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <Button
                            onClick={syncStrava}
                            disabled={stravaLoading}
                            className="w-full"
                        >
                            {stravaLoading ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Syncing...
                                </>
                            ) : (
                                'Sync from Strava'
                            )}
                        </Button>

                        {stravaResult && (
                            <div className="space-y-2 p-4 bg-muted rounded-lg">
                                {stravaResult.success ? (
                                    <>
                                        <div className="flex items-center gap-2 text-sm">
                                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                                            <span className="font-medium">Sync Complete</span>
                                        </div>
                                        <div className="grid grid-cols-3 gap-2 text-sm mt-3">
                                            <div>
                                                <div className="text-muted-foreground">Synced</div>
                                                <div className="text-lg font-bold">{stravaResult.synced || 0}</div>
                                            </div>
                                            <div>
                                                <div className="text-muted-foreground">Merged</div>
                                                <div className="text-lg font-bold">{stravaResult.merged || 0}</div>
                                            </div>
                                            <div>
                                                <div className="text-muted-foreground">Review</div>
                                                <div className="text-lg font-bold">{stravaResult.pendingReview || 0}</div>
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <div className="text-sm text-destructive">
                                        Error: {stravaResult.error || 'Unknown error'}
                                    </div>
                                )}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Next Steps</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                    <p>After syncing:</p>
                    <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                        <li>High-confidence matches are automatically merged</li>
                        <li>Medium/low-confidence matches require review at <code className="px-1 py-0.5 bg-muted rounded">/dashboard/activities/merge</code></li>
                        <li>Activities are stored with source tracking (garmin/strava/merged)</li>
                    </ul>
                </CardContent>
            </Card>
        </div>
    )
}
