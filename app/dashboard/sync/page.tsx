'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Input } from '@/components/ui/input'
import { Activity, CheckCircle2, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { format, startOfYear, endOfYear, subDays } from 'date-fns'

type DateRangeOption = 'latest' | 'week' | 'month' | 'year' | 'custom'

interface SyncResult {
    success: boolean
    synced?: number
    merged?: number
    pendingReview?: number
    error?: string
}

export default function ActivitySyncPage() {
    const [dateRange, setDateRange] = useState<DateRangeOption>('latest')
    const [customStartDate, setCustomStartDate] = useState<Date>()
    const [customEndDate, setCustomEndDate] = useState<Date>()

    const [garminResult, setGarminResult] = useState<SyncResult | null>(null)
    const [stravaResult, setStravaResult] = useState<SyncResult | null>(null)
    const [garminLoading, setGarminLoading] = useState(false)
    const [stravaLoading, setStravaLoading] = useState(false)

    const getDateRange = (): { startDate: string; endDate: string } => {
        const today = new Date()
        let start: Date
        let end: Date

        switch (dateRange) {
            case 'latest':
                // For latest, we'll use a very recent range and limit to 1 activity in the API
                start = subDays(today, 1)
                end = today
                break
            case 'week':
                // Last 7 days
                start = subDays(today, 7)
                end = today
                break
            case 'month':
                // Last 4 weeks (28 days)
                start = subDays(today, 28)
                end = today
                break
            case 'year':
                start = startOfYear(today)
                end = endOfYear(today)
                break
            case 'custom':
                if (!customStartDate || !customEndDate) {
                    toast.error('Please select both start and end dates')
                    throw new Error('Invalid custom date range')
                }
                start = customStartDate
                end = customEndDate
                break
        }

        return {
            startDate: format(start, 'yyyy-MM-dd'),
            endDate: format(end, 'yyyy-MM-dd')
        }
    }

    const syncGarmin = async () => {
        setGarminLoading(true)
        setGarminResult(null)
        try {
            const { startDate, endDate } = getDateRange()
            const limit = dateRange === 'latest' ? 1 : undefined
            const res = await fetch('/api/sync/garmin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ startDate, endDate, limit })
            })
            const data = await res.json()
            if (res.status === 409) {
                toast.error('Sync already in progress. Please wait and try again.')
                return
            }
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
            const { startDate, endDate } = getDateRange()
            const limit = dateRange === 'latest' ? 1 : undefined
            const res = await fetch('/api/sync/strava', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ startDate, endDate, limit })
            })
            const data = await res.json()
            if (res.status === 409) {
                toast.error('Sync already in progress. Please wait and try again.')
                return
            }
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

    const syncBoth = async () => {
        // Run sequentially to avoid race conditions with duplicate activity detection
        await syncGarmin()
        await syncStrava()
    }

    return (
        <div className="space-y-8">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Activity Sync</h1>
                <p className="text-muted-foreground">Sync your activities from Garmin and Strava</p>
            </div>

            {/* Date Range & Sync */}
            <Card className="w-full md:w-1/2">
                <CardHeader>
                    <CardTitle>Sync Activities</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col md:flex-row gap-8 max-w-xl">
                        {/* Left: Date Range */}
                        <div className="space-y-4 flex-1">
                            <Label className="text-sm font-medium text-muted-foreground">Date Range</Label>
                            <RadioGroup value={dateRange} onValueChange={(value: string) => setDateRange(value as DateRangeOption)}>
                                <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="latest" id="latest" />
                                    <Label htmlFor="latest">Latest Activity (Newest single activity only)</Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="week" id="week" />
                                    <Label htmlFor="week">Last 7 Days</Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="month" id="month" />
                                    <Label htmlFor="month">Last 4 Weeks</Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="year" id="year" />
                                    <Label htmlFor="year">This Year</Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="custom" id="custom" />
                                    <Label htmlFor="custom">Custom</Label>
                                </div>
                            </RadioGroup>

                            {dateRange === 'custom' && (
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="start-date">Start Date</Label>
                                        <Input
                                            id="start-date"
                                            type="date"
                                            className="h-10 text-base"
                                            value={customStartDate ? format(customStartDate, 'yyyy-MM-dd') : ''}
                                            onChange={(e) =>
                                                setCustomStartDate(
                                                    e.target.value ? new Date(e.target.value + 'T12:00:00') : undefined
                                                )
                                            }
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="end-date">End Date</Label>
                                        <Input
                                            id="end-date"
                                            type="date"
                                            className="h-10 text-base"
                                            value={customEndDate ? format(customEndDate, 'yyyy-MM-dd') : ''}
                                            onChange={(e) =>
                                                setCustomEndDate(
                                                    e.target.value ? new Date(e.target.value + 'T12:00:00') : undefined
                                                )
                                            }
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Right: Sync Buttons */}
                        <div className="flex flex-col gap-2 md:w-40 shrink-0">
                            <Button
                                onClick={syncGarmin}
                                disabled={garminLoading || stravaLoading}
                                size="sm"
                            >
                                {garminLoading ? (
                                    <>
                                        <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                                        Syncing...
                                    </>
                                ) : (
                                    <>
                                        <Activity className="h-3.5 w-3.5 mr-2" />
                                        Sync Garmin
                                    </>
                                )}
                            </Button>
                            <Button
                                onClick={syncStrava}
                                disabled={garminLoading || stravaLoading}
                                size="sm"
                            >
                                {stravaLoading ? (
                                    <>
                                        <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                                        Syncing...
                                    </>
                                ) : (
                                    <>
                                        <Activity className="h-3.5 w-3.5 mr-2" />
                                        Sync Strava
                                    </>
                                )}
                            </Button>
                            <Button
                                onClick={syncBoth}
                                disabled={garminLoading || stravaLoading}
                                variant="secondary"
                                size="sm"
                            >
                                {garminLoading || stravaLoading ? (
                                    <>
                                        <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                                        Syncing...
                                    </>
                                ) : (
                                    <>
                                        <RefreshCw className="h-3.5 w-3.5 mr-2" />
                                        Sync Both
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Results */}
            {(garminResult || stravaResult) && (
                <div className="grid gap-6 md:grid-cols-2">
                    {garminResult && (
                        <Card>
                            <CardHeader>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Activity className="h-5 w-5 text-blue-500" />
                                        <CardTitle>Garmin</CardTitle>
                                    </div>
                                    {garminResult.success && (
                                        <Badge className="bg-green-500">Success</Badge>
                                    )}
                                </div>
                            </CardHeader>
                            <CardContent>
                                {garminResult.success ? (
                                    <div className="space-y-2">
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
                                    </div>
                                ) : (
                                    <div className="text-sm text-destructive">
                                        Error: {garminResult.error || 'Unknown error'}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    )}

                    {stravaResult && (
                        <Card>
                            <CardHeader>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Activity className="h-5 w-5 text-orange-500" />
                                        <CardTitle>Strava</CardTitle>
                                    </div>
                                    {stravaResult.success && (
                                        <Badge className="bg-green-500">Success</Badge>
                                    )}
                                </div>
                            </CardHeader>
                            <CardContent>
                                {stravaResult.success ? (
                                    <div className="space-y-2">
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
                                    </div>
                                ) : (
                                    <div className="text-sm text-destructive">
                                        Error: {stravaResult.error || 'Unknown error'}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    )}
                </div>
            )}
        </div>
    )
}
