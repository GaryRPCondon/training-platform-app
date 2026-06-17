'use client'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { CheckCircle2, XCircle, Loader2, Wifi } from 'lucide-react'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog'
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
    const t = useTranslations('connections')
    const router = useRouter()
    const queryClient = useQueryClient()
    const [loading, setLoading] = useState<string | null>(null)
    const [stravaTest, setStravaTest] = useState<TestResult>({ status: 'idle' })
    const [showStravaPushWarning, setShowStravaPushWarning] = useState(false)

    const testStravaConnection = async () => {
        setStravaTest({ status: 'loading' })
        try {
            const res = await fetch('/api/connections/test/strava')
            const data = await res.json()
            if (data.connected) {
                setStravaTest({ status: 'success', message: data.displayName ? t('connectedAs', { name: data.displayName }) : t('connected') })
            } else {
                setStravaTest({ status: 'error', message: data.error || t('connectionFailed') })
            }
        } catch {
            setStravaTest({ status: 'error', message: t('connectionTestFailed') })
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
            toast.error(t('updatePreferenceFailed'))
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
            toast.error(t('updatePreferenceFailed'))
        }
    })

    // Mutation to update push summary preferences
    const updatePushSummaryMutation = useMutation({
        mutationFn: async (updates: { push_summary_to_garmin?: boolean; push_summary_to_strava?: boolean }) => {
            const response = await fetch('/api/settings/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            })
            if (!response.ok) throw new Error('Failed to update preference')
            return response.json()
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['athlete'] })
            await refetch()
        },
        onError: () => {
            toast.error(t('updatePreferenceFailed'))
        }
    })

    // Handler for Strava preference toggle
    const handleStravaPreferenceChange = (checked: boolean) => {
        if (checked) {
            updatePreferenceMutation.mutate('strava')
            toast.success(t('stravaPrioritized'))
        } else {
            updatePreferenceMutation.mutate('most_recent')
        }
    }

    // Handler for Garmin preference toggle
    const handleGarminPreferenceChange = (checked: boolean) => {
        if (checked) {
            updatePreferenceMutation.mutate('garmin')
            toast.success(t('garminPrioritized'))
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
        window.location.href = '/api/strava/auth'
    }

    const handleDisconnectStrava = async () => {
        if (!confirm(t('stravaDisconnectConfirm'))) return

        try {
            const response = await fetch('/api/strava/disconnect', { method: 'POST' })
            if (!response.ok) throw new Error('Failed to disconnect')
            toast.success(t('stravaDisconnected'))
            await queryClient.invalidateQueries({ queryKey: ['athlete'] })
            await queryClient.invalidateQueries({ queryKey: ['settings'] })
        } catch (error) {
            console.error('Failed to disconnect Strava:', error)
            toast.error(t('stravaDisconnectFailed'))
        }
    }

    const handleSyncOnLoginChange = (checked: boolean) => {
        updateSyncOnLoginMutation.mutate(checked)
        toast.success(checked ? t('syncOnLoginEnabled') : t('syncOnLoginDisabled'))
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('title')}</CardTitle>
                <CardDescription>{t('description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Sync on login toggle - only show when at least one integration connected */}
                {(garminConnected || stravaConnected) && (
                    <div className="flex items-center justify-between p-3 sm:p-4 border rounded-lg">
                        <div>
                            <Label htmlFor="sync-on-login" className="cursor-pointer">
                                {t('syncOnLoginLabel')}
                            </Label>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                {t('syncOnLoginHelp')}
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
                    pushSummaryToGarmin={athlete?.push_summary_to_garmin ?? false}
                    onPushSummaryChange={(checked) => {
                        updatePushSummaryMutation.mutate({ push_summary_to_garmin: checked })
                        toast.success(checked ? t('garminPushEnabled') : t('garminPushDisabled'))
                    }}
                />

                {/* Strava */}
                <div className="p-3 sm:p-4 border rounded-lg space-y-3">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
                            <div className="bg-[#FC4C02] text-white p-2 rounded w-10 h-10 flex items-center justify-center shrink-0">
                                <span className="font-bold">S</span>
                            </div>
                            <div className="min-w-0">
                                <div className="font-medium">{t('strava')}</div>
                                <div className="text-sm text-muted-foreground">
                                    {stravaConnected ? t('connected') : t('notConnected')}
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            {stravaConnected ? (
                                <>
                                    {stravaTest.status === 'success' ? (
                                        <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                                            <CheckCircle2 className="h-3 w-3" /> {t('connected')}
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
                                                <Loader2 className="me-1 h-3 w-3 animate-spin" />
                                            ) : (
                                                <Wifi className="me-1 h-3 w-3" />
                                            )}
                                            {t('test')}
                                        </Button>
                                    )}
                                    <Button variant="outline" size="sm" onClick={handleDisconnectStrava}>
                                        {t('disconnect')}
                                    </Button>
                                </>
                            ) : (
                                <Button
                                    size="sm"
                                    onClick={handleConnectStrava}
                                    disabled={loading === 'strava'}
                                    className="bg-[#FC4C02] hover:bg-[#E34402] text-white"
                                >
                                    {loading === 'strava' ? t('connecting') : t('connect')}
                                </Button>
                            )}
                        </div>
                    </div>

                    {/* Strava Data Priority Toggle */}
                    {(stravaConnected || garminConnected) && (
                        <div className="flex items-center justify-between pt-2 border-t">
                            <Label htmlFor="strava-prefer" className="text-sm text-muted-foreground cursor-pointer">
                                {t('preferSource')}
                            </Label>
                            <Switch
                                id="strava-prefer"
                                checked={stravaPreferred}
                                onCheckedChange={handleStravaPreferenceChange}
                                disabled={!stravaConnected}
                            />
                        </div>
                    )}

                    {/* Write AI summaries toggle */}
                    {stravaConnected && (
                        <div className="flex items-center justify-between pt-2 border-t">
                            <Label htmlFor="strava-push-summary" className="text-sm text-muted-foreground cursor-pointer">
                                {t('writeSummariesStrava')}
                            </Label>
                            <Switch
                                id="strava-push-summary"
                                checked={athlete?.push_summary_to_strava ?? false}
                                onCheckedChange={(checked) => {
                                    if (checked) {
                                        setShowStravaPushWarning(true)
                                    } else {
                                        updatePushSummaryMutation.mutate({ push_summary_to_strava: false })
                                        toast.success(t('stravaPushDisabled'))
                                    }
                                }}
                                disabled={updatePushSummaryMutation.isPending}
                            />
                        </div>
                    )}
                </div>

                <AlertDialog open={showStravaPushWarning} onOpenChange={setShowStravaPushWarning}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>{t('stravaPushDialogTitle')}</AlertDialogTitle>
                            <AlertDialogDescription>
                                {t('stravaPushDialogDescription')}
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                            <AlertDialogAction onClick={() => {
                                updatePushSummaryMutation.mutate({ push_summary_to_strava: true })
                                toast.success(t('stravaPushEnabled'))
                            }}>
                                {t('enable')}
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </CardContent>
        </Card>
    )
}
