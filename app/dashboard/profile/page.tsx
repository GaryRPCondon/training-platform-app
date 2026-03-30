'use client'

import { Suspense, useState } from 'react'
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

export default function ProfilePage() {
    return (
        <Suspense fallback={<ProfileSkeleton />}>
            <ProfileContent />
        </Suspense>
    )
}

function ProfileContent() {
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
                throw new Error(data.error || 'Failed to delete account')
            }
            toast.success('Account deleted successfully')
            router.push('/login')
            router.refresh()
        } catch (err: any) {
            toast.error(err.message || 'Failed to delete account')
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
            toast.success('Profile setup complete!')
            router.replace('/dashboard/profile')
            router.refresh()
        } catch {
            toast.error('Failed to save profile')
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
            toast.success('Logged out successfully')
            router.push('/login')
            router.refresh()
        } catch (error) {
            console.error('Error logging out:', error)
            toast.error('Failed to log out')
        }
    }

    if (isLoading || vdotLoading) {
        return <ProfileSkeleton />
    }

    if (error) {
        return <div>Error loading profile</div>
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold tracking-tight">Profile</h1>
                <Button
                    variant="outline"
                    onClick={handleLogout}
                    className="gap-2"
                >
                    <LogOut className="h-4 w-4" />
                    Logout
                </Button>
            </div>

            {isOnboarding && (
                <Alert className="border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950">
                    <PartyPopper className="h-4 w-4" />
                    <AlertDescription>
                        <strong>Welcome to TrAIner!</strong> Please complete your profile below — set your preferences, connect your fitness accounts, and choose an AI provider. When you&apos;re ready, click &quot;Complete Setup&quot; to get started.
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
                        Complete Setup
                    </Button>
                </div>
            )}

            {/* Delete Account */}
            <Card className="border-destructive/50">
                <CardHeader className="text-center">
                    <div className="flex items-center justify-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-destructive" />
                        <CardTitle>Delete Account</CardTitle>
                    </div>
                    <CardDescription>
                        Permanently delete your account and all associated data. This action cannot be undone.
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex justify-center">
                    <Dialog open={deleteDialogOpen} onOpenChange={(open) => {
                        setDeleteDialogOpen(open)
                        if (!open) setDeleteConfirm('')
                    }}>
                        <DialogTrigger asChild>
                            <Button variant="destructive">
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete My Account
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Are you absolutely sure?</DialogTitle>
                                <DialogDescription>
                                    This will permanently delete your account, all training plans, activities, chat history, and integrations. This cannot be undone.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <p className="text-sm text-muted-foreground">
                                        Type <strong>DELETE</strong> to confirm:
                                    </p>
                                    <Input
                                        aria-label="Type DELETE to confirm account deletion"
                                        value={deleteConfirm}
                                        onChange={(e) => setDeleteConfirm(e.target.value)}
                                        placeholder="Type DELETE to confirm"
                                    />
                                </div>
                                <Button
                                    variant="destructive"
                                    className="w-full"
                                    disabled={deleteConfirm !== 'DELETE' || deleteLoading}
                                    onClick={handleDeleteAccount}
                                >
                                    {deleteLoading ? 'Deleting...' : 'Permanently Delete Account'}
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
