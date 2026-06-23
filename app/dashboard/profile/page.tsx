'use client'

import { Suspense, useState } from 'react'
import { errorMessage } from '@/lib/utils/errors'
import { useQuery } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import { getAthleteProfile } from '@/lib/supabase/queries'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AISettingsCard } from '@/components/settings/ai-settings-card'
import { ConnectionsCard } from '@/components/settings/connections-card'
import { PreferencesCard } from '@/components/settings/preferences-card'
import { PerformanceMetricsCard } from '@/components/settings/performance-metrics-card'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog'
import { LogOut, Trash2, AlertTriangle, PartyPopper } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'

export default function ProfilePage() {
    return (
        <Suspense fallback={<ProfileSkeleton />}>
            <ProfileContent />
        </Suspense>
    )
}

function ProfileContent() {
    const t = useTranslations('profile')
    const router = useRouter()
    const searchParams = useSearchParams()
    const isOnboarding = searchParams.get('onboarding') === 'true'
    const [deleteConfirm, setDeleteConfirm] = useState('')
    const [deleteLoading, setDeleteLoading] = useState(false)
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

    const { data: athlete, isLoading, error } = useQuery({
        queryKey: ['athlete'],
        queryFn: getAthleteProfile,
    })

    const { data: vdotData, isLoading: vdotLoading } = useQuery({
        queryKey: ['vdot'],
        queryFn: async () => {
            const res = await fetch('/api/plans/vdot')
            if (!res.ok) return null
            return res.json()
        },
    })

    async function handleDeleteAccount() {
        setDeleteLoading(true)
        try {
            const res = await fetch('/api/auth/delete-account', { method: 'DELETE' })
            if (!res.ok) {
                const data = await res.json()
                throw new Error(data.error || t('deleteFailed'))
            }
            toast.success(t('accountDeleted'))
            router.push('/login')
            router.refresh()
        } catch (err: unknown) {
            toast.error(errorMessage(err) || t('deleteFailed'))
        } finally {
            setDeleteLoading(false)
        }
    }

    async function handleCompleteOnboarding() {
        try {
            const res = await fetch('/api/settings/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ profile_completed: true }),
            })
            if (!res.ok) throw new Error()
            toast.success(t('profileComplete'))
            router.replace('/dashboard/profile')
            router.refresh()
        } catch {
            toast.error(t('profileSaveFailed'))
        }
    }

    async function handleLogout() {
        try {
            const response = await fetch('/api/auth/logout', {
                method: 'POST'
            })

            if (!response.ok) {
                throw new Error('Logout failed')
            }

            sessionStorage.removeItem('auto_sync_done')
            toast.success(t('loggedOut'))
            router.push('/login')
            router.refresh()
        } catch (error) {
            console.error('Error logging out:', error)
            toast.error(t('logoutFailed'))
        }
    }

    if (isLoading || vdotLoading) {
        return <ProfileSkeleton />
    }

    if (error) {
        return <div>{t('errorLoading')}</div>
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
                <Button
                    variant="outline"
                    onClick={handleLogout}
                    className="gap-2"
                >
                    <LogOut className="h-4 w-4" />
                    {t('logout')}
                </Button>
            </div>

            {isOnboarding && (
                <Alert className="border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950">
                    <PartyPopper className="h-4 w-4" />
                    <AlertDescription>
                        {t.rich('onboardingWelcome', { b: (chunks) => <strong>{chunks}</strong> })}
                    </AlertDescription>
                </Alert>
            )}

            <div className="grid gap-6 md:grid-cols-2 [&>*]:min-w-0">
                <PreferencesCard />
                <PerformanceMetricsCard initialData={vdotData} />
                <AISettingsCard />
                <ConnectionsCard
                    stravaConnected={!!athlete?.strava_connected}
                    garminConnected={!!athlete?.garmin_connected}
                />
            </div>

            {isOnboarding && (
                <div className="flex justify-center">
                    <Button size="lg" onClick={handleCompleteOnboarding}>
                        {t('completeSetup')}
                    </Button>
                </div>
            )}

            {/* Delete Account */}
            <Card className="border-destructive/50">
                <CardHeader className="text-center">
                    <div className="flex items-center justify-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-destructive" />
                        <CardTitle>{t('deleteAccount')}</CardTitle>
                    </div>
                    <CardDescription>
                        {t('deleteAccountDescription')}
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex justify-center">
                    <Dialog open={deleteDialogOpen} onOpenChange={(open) => {
                        setDeleteDialogOpen(open)
                        if (!open) setDeleteConfirm('')
                    }}>
                        <DialogTrigger asChild>
                            <Button variant="destructive">
                                <Trash2 className="me-2 h-4 w-4" />
                                {t('deleteMyAccount')}
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>{t('deleteDialogTitle')}</DialogTitle>
                                <DialogDescription>
                                    {t('deleteDialogDescription')}
                                </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <p className="text-sm text-muted-foreground">
                                        {t.rich('deleteConfirmHint', { keyword: 'DELETE', b: (chunks) => <strong>{chunks}</strong> })}
                                    </p>
                                    <Input
                                        aria-label={t('deleteConfirmAriaLabel')}
                                        value={deleteConfirm}
                                        onChange={(e) => setDeleteConfirm(e.target.value)}
                                        placeholder={t('deleteConfirmPlaceholder')}
                                    />
                                </div>
                                <Button
                                    variant="destructive"
                                    className="w-full"
                                    disabled={deleteConfirm !== 'DELETE' || deleteLoading}
                                    onClick={handleDeleteAccount}
                                >
                                    {deleteLoading ? t('deleting') : t('deleteButton')}
                                </Button>
                            </div>
                        </DialogContent>
                    </Dialog>
                </CardContent>
            </Card>
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
