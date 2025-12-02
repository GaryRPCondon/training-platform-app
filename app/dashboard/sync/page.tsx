'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Activity, CheckCircle2, Loader2, CalendarIcon, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, subDays } from 'date-fns'
import { cn } from '@/lib/utils'

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
        await Promise.all([syncGarmin(), syncStrava()])
    }

    return (
        <div className="container mx-auto p-6 space-y-8">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Activity Sync</h1>
                <p className="text-muted-foreground">Sync your activities from Garmin and Strava</p>
            </div>

            {/* Date Range Selector */}
            <Card>
                <CardHeader>
                    <CardTitle>Select Date Range</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
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
                        <div className="grid grid-cols-2 gap-4 pl-6">
                            <div className="space-y-2">
                                <Label>Start Date</Label>
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button
                                            variant="outline"
                                            className={cn(
                                                "w-full justify-start text-left font-normal",
                                                !customStartDate && "text-muted-foreground"
                                            )}
                                        >
                                            <CalendarIcon className="mr-2 h-4 w-4" />
                                            {customStartDate ? format(customStartDate, 'PPP') : 'Pick a date'}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0">
                                        <Calendar
                                            mode="single"
                                            selected={customStartDate}
                                            onSelect={setCustomStartDate}
                                            initialFocus
                                        />
                                    </PopoverContent>
                                </Popover>
                            </div>
                            <div className="space-y-2">
                                <Label>End Date</Label>
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button
                                            variant="outline"
                                            className={cn(
                                                "w-full justify-start text-left font-normal",
                                                !customEndDate && "text-muted-foreground"
                                            )}
                                        >
                                            <CalendarIcon className="mr-2 h-4 w-4" />
                                            {customEndDate ? format(customEndDate, 'PPP') : 'Pick a date'}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0">
                                        <Calendar
                                            mode="single"
                                            selected={customEndDate}
                                            onSelect={setCustomEndDate}
                                            initialFocus
                                        />
                                    </PopoverContent>
                                </Popover>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Sync Buttons */}
            <Card>
                <CardHeader>
                    <CardTitle>Sync Activities</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <Button
                            onClick={syncGarmin}
                            disabled={garminLoading || stravaLoading}
                            className="w-full"
                        >
                            {garminLoading ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Syncing...
                                </>
                            ) : (
                                <>
                                    <Activity className="h-4 w-4 mr-2" />
                                    Sync from Garmin
                                </>
                            )}
                        </Button>
                        <Button
                            onClick={syncStrava}
                            disabled={garminLoading || stravaLoading}
                            className="w-full"
                        >
                            {stravaLoading ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Syncing...
                                </>
                            ) : (
                                <>
                                    <Activity className="h-4 w-4 mr-2" />
                                    Sync from Strava
                                </>
                            )}
                        </Button>
                    </div>
                    <Button
                        onClick={syncBoth}
                        disabled={garminLoading || stravaLoading}
                        variant="secondary"
                        className="w-full"
                    >
                        {garminLoading || stravaLoading ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Syncing...
                            </>
                        ) : (
                            <>
                                <RefreshCw className="h-4 w-4 mr-2" />
                                Sync Both
                            </>
                        )}
                    </Button>
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
