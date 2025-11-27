'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AlertCircle, CheckCircle, Loader2, TrendingDown, Calendar } from 'lucide-react'
import { toast } from 'sonner'

async function getObservations() {
    const response = await fetch('/api/observations')
    if (!response.ok) throw new Error('Failed to fetch observations')
    return response.json()
}

async function dismissObservation(observationId: string) {
    const response = await fetch('/api/observations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dismiss', observationId })
    })
    if (!response.ok) throw new Error('Failed to dismiss observation')
    return response.json()
}

export function ObservationsPanel() {
    const queryClient = useQueryClient()
    const { data, isLoading, error } = useQuery({
        queryKey: ['observations'],
        queryFn: getObservations,
    })

    const dismissMutation = useMutation({
        mutationFn: dismissObservation,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['observations'] })
            toast.success('Observation dismissed')
        },
        onError: () => {
            toast.error('Failed to dismiss observation')
        }
    })

    const acceptMutation = useMutation({
        mutationFn: async (adjustmentId: string) => {
            const response = await fetch('/api/adjustments/apply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ adjustmentId: parseInt(adjustmentId) })
            })
            if (!response.ok) throw new Error('Failed to apply adjustment')
            return response.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['observations'] })
            toast.success('Adjustment applied successfully')
        },
        onError: () => {
            toast.error('Failed to apply adjustment')
        }
    })

    const rejectMutation = useMutation({
        mutationFn: async (adjustmentId: string) => {
            const response = await fetch('/api/adjustments/reject', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ adjustmentId: parseInt(adjustmentId) })
            })
            if (!response.ok) throw new Error('Failed to reject adjustment')
            return response.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['observations'] })
            toast.success('Adjustment rejected')
        },
        onError: () => {
            toast.error('Failed to reject adjustment')
        }
    })

    if (isLoading) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <AlertCircle className="h-5 w-5" />
                        Observations
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex justify-center py-6">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </CardContent>
            </Card>
        )
    }

    if (error) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Observations</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="text-destructive">Failed to load observations</div>
                </CardContent>
            </Card>
        )
    }

    const observations = data?.observations || []
    const adjustments = data?.adjustments || []

    return (
        <div className="space-y-6">
            {/* Observations Card */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <AlertCircle className="h-5 w-5" />
                        Observations
                        {observations.length > 0 && (
                            <Badge variant="destructive" className="ml-auto">
                                {observations.length} New
                            </Badge>
                        )}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {observations.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-6 text-muted-foreground gap-2">
                            <CheckCircle className="h-8 w-8 text-green-500" />
                            <p>No concerns detected</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {observations.map((obs: any) => (
                                <div key={obs.id} className="flex items-start gap-4 p-3 rounded-lg border bg-card text-card-foreground shadow-sm">
                                    <div className={`mt-1 h-2 w-2 rounded-full ${obs.severity === 'concern' ? 'bg-red-500' :
                                        obs.severity === 'warning' ? 'bg-yellow-500' :
                                            'bg-blue-500'
                                        }`} />
                                    <div className="flex-1 space-y-1">
                                        <div className="flex items-center justify-between">
                                            <p className="font-medium leading-none">
                                                {obs.type.replace(/_/g, ' ').toUpperCase()}
                                            </p>
                                            <span className="text-xs text-muted-foreground">
                                                {new Date(obs.created_at).toLocaleDateString()}
                                            </span>
                                        </div>
                                        <p className="text-sm text-muted-foreground">
                                            {obs.message}
                                        </p>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => dismissMutation.mutate(obs.id)}
                                        disabled={dismissMutation.isPending}
                                    >
                                        Dismiss
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Adjustments Card */}
            {adjustments.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <TrendingDown className="h-5 w-5" />
                            Suggested Adjustments
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            {adjustments.map((adj: any) => (
                                <div key={adj.id} className="p-4 rounded-lg border bg-muted/50">
                                    <div className="flex items-start justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                            <Calendar className="h-4 w-4 text-muted-foreground" />
                                            <h4 className="font-semibold">{adj.title}</h4>
                                        </div>
                                        <Badge variant="outline">{adj.type.replace(/_/g, ' ')}</Badge>
                                    </div>
                                    <p className="text-sm text-muted-foreground mb-2">{adj.description}</p>
                                    <div className="text-xs text-muted-foreground mb-3">
                                        <strong>Why:</strong> {adj.rationale}
                                    </div>
                                    <div className="text-xs text-muted-foreground mb-3">
                                        <strong>Impact:</strong> {adj.impact}
                                    </div>
                                    <div className="flex gap-2">
                                        <Button
                                            size="sm"
                                            variant="default"
                                            onClick={() => acceptMutation.mutate(adj.id)}
                                            disabled={acceptMutation.isPending || rejectMutation.isPending}
                                        >
                                            Accept
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => rejectMutation.mutate(adj.id)}
                                            disabled={acceptMutation.isPending || rejectMutation.isPending}
                                        >
                                            Reject
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    )
}
