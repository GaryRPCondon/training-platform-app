'use client'

import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useEffect, useState } from 'react'
import { TrainingPlan } from '@/types/database'
import { activatePlan } from '@/lib/supabase/plan-activation'
import { getCurrentAthleteId } from '@/lib/supabase/client'
import { format, parseISO } from 'date-fns'
import { Trash2, Download, Trophy } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'

export default function PlansPage() {
    const t = useTranslations('plansList')
    const [plans, setPlans] = useState<TrainingPlan[]>([])
    const [loading, setLoading] = useState(true)
    const [athleteId, setAthleteId] = useState<string | null>(null)

    useEffect(() => {
        fetchPlans()
    }, [])

    async function fetchPlans() {
        try {
            const id = await getCurrentAthleteId()
            setAthleteId(id)

            const response = await fetch('/api/plans')
            const data = await response.json()
            setPlans(data.plans || [])
        } catch (error) {
            console.error('Error fetching plans:', error)
        } finally {
            setLoading(false)
        }
    }

    async function handleActivate(planId: number) {
        if (!athleteId) return

        try {
            await activatePlan(planId, athleteId)
            await fetchPlans() // Refresh the list
        } catch (error) {
            console.error('Error activating plan:', error)
            alert(t('activateFailed'))
        }
    }

    async function handleDelete(planId: number, type: 'active' | 'draft' | 'completed') {
        const base =
            type === 'completed'
                ? t('confirmDeleteCompleted')
                : type === 'active'
                ? t('confirmDeleteActive')
                : t('confirmDeleteDraft')
        const message = type === 'completed'
            ? base
            : base + t('garminDeleteNote')

        if (!confirm(message)) {
            return
        }

        try {
            const response = await fetch(`/api/plans/${planId}`, {
                method: 'DELETE'
            })

            if (!response.ok) {
                const data = await response.json()
                throw new Error(data.error || t('deleteFailed'))
            }

            toast.success(t('deleteSuccess'))
            await fetchPlans() // Refresh the list
        } catch (error) {
            console.error('Error deleting plan:', error)
            toast.error(t('deleteFailed'))
        }
    }

    if (loading) {
        return <div>{t('loading')}</div>
    }

    const activePlans = plans.filter(p => p.status === 'active')
    const draftPlans = plans.filter(p => p.status === 'draft' || p.status === 'draft_generated')
    const completedPlans = plans.filter(p => p.status === 'completed')

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
                <Button asChild>
                    <Link href="/dashboard/plans/new">{t('createNew')}</Link>
                </Button>
            </div>

            {/* Active Plans */}
            <div className="grid gap-4">
                <Card>
                    <CardHeader>
                        <CardTitle>{t('activePlans')}</CardTitle>
                        <CardDescription>{t('activePlansDesc')}</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {activePlans.length === 0 ? (
                            <p className="text-muted-foreground">{t('noActivePlans')}</p>
                        ) : (
                            <div className="space-y-4">
                                {activePlans.map(plan => (
                                    <Card key={plan.id}>
                                        <CardHeader>
                                            <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
                                                <div>
                                                    <CardTitle className="text-lg">{plan.name}</CardTitle>
                                                    <CardDescription>
                                                        {format(parseISO(plan.start_date), 'MMM d, yyyy')} - {format(parseISO(plan.end_date), 'MMM d, yyyy')}
                                                    </CardDescription>
                                                </div>
                                                <Badge variant="default">{t('active')}</Badge>
                                            </div>
                                        </CardHeader>
                                        <CardContent>
                                            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                                                <div className="text-sm text-muted-foreground">
                                                    <div>{t('typeLabel', { type: plan.plan_type ?? '' })}</div>
                                                    <div>{t('createdLabel', { date: format(parseISO(plan.created_at), 'MMM d, yyyy') })}</div>
                                                </div>
                                                <div className="flex flex-col sm:flex-row w-full sm:w-auto gap-2">
                                                    <Button
                                                        variant="outline"
                                                        onClick={() => {
                                                            window.open(`/api/plans/${plan.id}/export-ics`)
                                                            toast.info(
                                                                t('exportTip'),
                                                                { duration: 8000 }
                                                            )
                                                        }}
                                                    >
                                                        <Download className="me-2 h-4 w-4" />
                                                        {t('exportToCalendar')}
                                                    </Button>
                                                    <Button
                                                        variant="destructive"
                                                        onClick={() => handleDelete(plan.id, 'active')}
                                                    >
                                                        <Trash2 className="me-2 h-4 w-4" />
                                                        {t('deleteActiveBtn')}
                                                    </Button>
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Draft Plans */}
            {draftPlans.length > 0 && (
                <div className="grid gap-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>{t('draftPlans')}</CardTitle>
                            <CardDescription>{t('draftPlansDesc')}</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                {draftPlans.map(plan => (
                                    <Card key={plan.id}>
                                        <CardHeader>
                                            <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
                                                <div>
                                                    <CardTitle className="text-lg">{plan.name}</CardTitle>
                                                    <CardDescription>
                                                        {format(parseISO(plan.start_date), 'MMM d, yyyy')} - {format(parseISO(plan.end_date), 'MMM d, yyyy')}
                                                    </CardDescription>
                                                </div>
                                                <Badge variant="secondary">{t('draft')}</Badge>
                                            </div>
                                        </CardHeader>
                                        <CardContent>
                                            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                                                <div className="text-sm text-muted-foreground">
                                                    <div>{t('typeLabel', { type: plan.plan_type ?? '' })}</div>
                                                    <div>{t('createdLabel', { date: format(parseISO(plan.created_at), 'MMM d, yyyy') })}</div>
                                                </div>
                                                <div className="flex flex-col sm:flex-row w-full sm:w-auto gap-2">
                                                    <Button asChild>
                                                        <Link href={`/dashboard/plans/review/${plan.id}`}>
                                                            {t('reviewPlan')}
                                                        </Link>
                                                    </Button>
                                                    <Button onClick={() => handleActivate(plan.id)}>
                                                        {t('activatePlan')}
                                                    </Button>
                                                    <Button
                                                        variant="destructive"
                                                        onClick={() => handleDelete(plan.id, 'draft')}
                                                    >
                                                        <Trash2 className="me-2 h-4 w-4" />
                                                        {t('deleteDraftBtn')}
                                                    </Button>
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* Completed Plans */}
            {completedPlans.length > 0 && (
                <div className="grid gap-4">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Trophy className="h-5 w-5 text-amber-500" />
                                {t('completedPlans')}
                            </CardTitle>
                            <CardDescription>{t('completedPlansDesc')}</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                {completedPlans.map(plan => (
                                    <Card key={plan.id} className="border-amber-200/60 dark:border-amber-800/40">
                                        <CardHeader>
                                            <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
                                                <div>
                                                    <CardTitle className="text-lg">{plan.name}</CardTitle>
                                                    <CardDescription>
                                                        {format(parseISO(plan.start_date), 'MMM d, yyyy')} – {format(parseISO(plan.end_date), 'MMM d, yyyy')}
                                                    </CardDescription>
                                                </div>
                                                <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-400">
                                                    <Trophy className="me-1 h-3 w-3" />
                                                    {t('completed')}
                                                </Badge>
                                            </div>
                                        </CardHeader>
                                        <CardContent>
                                            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                                                <div className="text-sm text-muted-foreground">
                                                    <div>Type: {plan.plan_type}</div>
                                                    {plan.completed_at && (
                                                        <div>{t('completedLabel', { date: format(parseISO(plan.completed_at), 'MMM d, yyyy') })}</div>
                                                    )}
                                                </div>
                                                <Button
                                                    variant="destructive"
                                                    onClick={() => handleDelete(plan.id, 'completed')}
                                                >
                                                    <Trash2 className="me-2 h-4 w-4" />
                                                    {t('deleteHistoryBtn')}
                                                </Button>
                                            </div>
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}
        </div>
    )
}
