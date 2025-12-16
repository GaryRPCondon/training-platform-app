'use client'

import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useEffect, useState } from 'react'
import { TrainingPlan } from '@/types/database'
import { activatePlan } from '@/lib/supabase/plan-activation'
import { getCurrentAthleteId } from '@/lib/supabase/client'
import { format } from 'date-fns'

export default function PlansPage() {
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
            alert('Failed to activate plan')
        }
    }

    if (loading) {
        return <div>Loading plans...</div>
    }

    const activePlans = plans.filter(p => p.status === 'active')
    const draftPlans = plans.filter(p => p.status === 'draft' || p.status === 'draft_generated')

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold tracking-tight">Training Plans</h1>
                <Button asChild>
                    <Link href="/dashboard/plans/new">Create New Plan</Link>
                </Button>
            </div>

            {/* Active Plans */}
            <div className="grid gap-4">
                <Card>
                    <CardHeader>
                        <CardTitle>Active Plans</CardTitle>
                        <CardDescription>Currently active training plans</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {activePlans.length === 0 ? (
                            <p className="text-muted-foreground">No active plans found.</p>
                        ) : (
                            <div className="space-y-4">
                                {activePlans.map(plan => (
                                    <Card key={plan.id}>
                                        <CardHeader>
                                            <div className="flex items-start justify-between">
                                                <div>
                                                    <CardTitle className="text-lg">{plan.name}</CardTitle>
                                                    <CardDescription>
                                                        {format(new Date(plan.start_date), 'MMM d, yyyy')} - {format(new Date(plan.end_date), 'MMM d, yyyy')}
                                                    </CardDescription>
                                                </div>
                                                <Badge variant="default">Active</Badge>
                                            </div>
                                        </CardHeader>
                                        <CardContent>
                                            <div className="text-sm text-muted-foreground">
                                                <div>Type: {plan.plan_type}</div>
                                                <div>Created: {format(new Date(plan.created_at), 'MMM d, yyyy')}</div>
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
                            <CardTitle>Draft Plans</CardTitle>
                            <CardDescription>Plans ready to be activated</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                {draftPlans.map(plan => (
                                    <Card key={plan.id}>
                                        <CardHeader>
                                            <div className="flex items-start justify-between">
                                                <div>
                                                    <CardTitle className="text-lg">{plan.name}</CardTitle>
                                                    <CardDescription>
                                                        {format(new Date(plan.start_date), 'MMM d, yyyy')} - {format(new Date(plan.end_date), 'MMM d, yyyy')}
                                                    </CardDescription>
                                                </div>
                                                <Badge variant="secondary">Draft</Badge>
                                            </div>
                                        </CardHeader>
                                        <CardContent>
                                            <div className="flex items-center justify-between">
                                                <div className="text-sm text-muted-foreground">
                                                    <div>Type: {plan.plan_type}</div>
                                                    <div>Created: {format(new Date(plan.created_at), 'MMM d, yyyy')}</div>
                                                </div>
                                                <div className="flex flex-col gap-2">
                                                    <Button asChild>
                                                        <Link href={`/dashboard/plans/review/${plan.id}`}>
                                                            Review Plan
                                                        </Link>
                                                    </Button>
                                                    <Button onClick={() => handleActivate(plan.id)}>
                                                        Activate Plan
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
        </div>
    )
}
