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
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'

type DateRangeOption = 'latest' | 'week' | 'month' | 'year' | 'custom'

interface SyncResult {
    success: boolean
    synced?: number
    merged?: number
    pendingReview?: number
    error?: string
}

export default function ActivitySyncPage() {
    const t = useTranslations('sync')
    const queryClient = useQueryClient()
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
                    toast.error(t('selectBothDates'))
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

    const autoMatchActivities = async (startDate: string, endDate: string) => {
        try {
            const res = await fetch('/api/activities/match', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ startDate, endDate })
            })
            const data = await res.json()
            if (data.matchCount > 0) {
                toast.success(t('matchedToWorkouts', { count: data.matchCount }))
            }
        } catch {
            // Non-critical - don't block sync results
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
                toast.error(t('syncInProgress'))
                return
            }
            setGarminResult(data)
            if (data.success) {
                const { startDate, endDate } = getDateRange()
                await autoMatchActivities(startDate, endDate)
                queryClient.invalidateQueries({ queryKey: ['activities'] })
                queryClient.invalidateQueries({ queryKey: ['workouts'] })
                toast.success(t('garminComplete', { count: data.synced }))
            } else {
                toast.error(data.error || t('syncFailed'))
            }
        } catch (error) {
            setGarminResult({ success: false, error: String(error) })
            toast.error(t('syncFailed'))
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
                toast.error(t('syncInProgress'))
                return
            }
            setStravaResult(data)
            if (data.success) {
                const { startDate, endDate } = getDateRange()
                await autoMatchActivities(startDate, endDate)
                queryClient.invalidateQueries({ queryKey: ['activities'] })
                queryClient.invalidateQueries({ queryKey: ['workouts'] })
                toast.success(t('stravaComplete', { count: data.synced }))
            } else {
                toast.error(data.error || t('syncFailed'))
            }
        } catch (error) {
            setStravaResult({ success: false, error: String(error) })
            toast.error(t('syncFailed'))
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
                <h1 className="text-3xl font-bold tracking-tight">{t('pageTitle')}</h1>
                <p className="text-muted-foreground">{t('pageSubtitle')}</p>
            </div>

            <div aria-live="polite" role="status" className="sr-only">
                {garminLoading ? t('srGarmin') : ''}
                {stravaLoading ? t('srStrava') : ''}
            </div>

            {/* Date Range & Sync */}
            <Card className="w-full md:w-1/2">
                <CardHeader>
                    <CardTitle>{t('syncActivities')}</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col md:flex-row gap-8 max-w-xl">
                        {/* Left: Date Range */}
                        <div className="space-y-4 flex-1">
                            <Label className="text-sm font-medium text-muted-foreground">{t('dateRange')}</Label>
                            <RadioGroup value={dateRange} onValueChange={(value: string) => setDateRange(value as DateRangeOption)}>
                                <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="latest" id="latest" />
                                    <Label htmlFor="latest">{t('rangeLatest')}</Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="week" id="week" />
                                    <Label htmlFor="week">{t('rangeWeek')}</Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="month" id="month" />
                                    <Label htmlFor="month">{t('rangeMonth')}</Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="year" id="year" />
                                    <Label htmlFor="year">{t('rangeYear')}</Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="custom" id="custom" />
                                    <Label htmlFor="custom">{t('rangeCustom')}</Label>
                                </div>
                            </RadioGroup>

                            {dateRange === 'custom' && (
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="start-date">{t('startDate')}</Label>
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
                                        <Label htmlFor="end-date">{t('endDate')}</Label>
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
                                        {t('syncing')}
                                    </>
                                ) : (
                                    <>
                                        <Activity className="h-3.5 w-3.5 mr-2" />
                                        {t('syncGarmin')}
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
                                        {t('syncing')}
                                    </>
                                ) : (
                                    <>
                                        <Activity className="h-3.5 w-3.5 mr-2" />
                                        {t('syncStrava')}
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
                                        {t('syncing')}
                                    </>
                                ) : (
                                    <>
                                        <RefreshCw className="h-3.5 w-3.5 mr-2" />
                                        {t('syncBoth')}
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
                                        <CardTitle>{t('garmin')}</CardTitle>
                                    </div>
                                    {garminResult.success && (
                                        <Badge className="bg-green-500">{t('success')}</Badge>
                                    )}
                                </div>
                            </CardHeader>
                            <CardContent>
                                {garminResult.success ? (
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2 text-sm">
                                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                                            <span className="font-medium">{t('syncComplete')}</span>
                                        </div>
                                        <div className="grid grid-cols-3 gap-2 text-sm mt-3">
                                            <div>
                                                <div className="text-muted-foreground">{t('synced')}</div>
                                                <div className="text-lg font-bold">{garminResult.synced || 0}</div>
                                            </div>
                                            <div>
                                                <div className="text-muted-foreground">{t('merged')}</div>
                                                <div className="text-lg font-bold">{garminResult.merged || 0}</div>
                                            </div>
                                            <div>
                                                <div className="text-muted-foreground">{t('review')}</div>
                                                <div className="text-lg font-bold">{garminResult.pendingReview || 0}</div>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-sm text-destructive">
                                        {t('errorPrefix', { error: garminResult.error || t('unknownError') })}
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
                                        <CardTitle>{t('strava')}</CardTitle>
                                    </div>
                                    {stravaResult.success && (
                                        <Badge className="bg-green-500">{t('success')}</Badge>
                                    )}
                                </div>
                            </CardHeader>
                            <CardContent>
                                {stravaResult.success ? (
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2 text-sm">
                                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                                            <span className="font-medium">{t('syncComplete')}</span>
                                        </div>
                                        <div className="grid grid-cols-3 gap-2 text-sm mt-3">
                                            <div>
                                                <div className="text-muted-foreground">{t('synced')}</div>
                                                <div className="text-lg font-bold">{stravaResult.synced || 0}</div>
                                            </div>
                                            <div>
                                                <div className="text-muted-foreground">{t('merged')}</div>
                                                <div className="text-lg font-bold">{stravaResult.merged || 0}</div>
                                            </div>
                                            <div>
                                                <div className="text-muted-foreground">{t('review')}</div>
                                                <div className="text-lg font-bold">{stravaResult.pendingReview || 0}</div>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-sm text-destructive">
                                        {t('errorPrefix', { error: stravaResult.error || t('unknownError') })}
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
