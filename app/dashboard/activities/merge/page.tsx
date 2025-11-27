'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { format } from 'date-fns'
import { CheckCircle2, XCircle, Activity as ActivityIcon } from 'lucide-react'
import { toast } from 'sonner'

interface Activity {
    id: number
    activity_name: string
    start_time: string
    distance_meters: number
    duration_seconds: number
    source: string
    confidence_score?: number
}

interface MergePair {
    activity: Activity
    matchActivity: Activity
    confidence: string
    confidenceScore: number
}

export default function MergeReviewPage() {
    const queryClient = useQueryClient()

    const { data: mergePairs, isLoading } = useQuery({
        queryKey: ['merge-candidates'],
        queryFn: async () => {
            const res = await fetch('/api/activities/merge/candidates')
            if (!res.ok) throw new Error('Failed to fetch')
            return res.json()
        }
    })

    const approveMutation = useMutation({
        mutationFn: async ({ activity1Id, activity2Id }: { activity1Id: number, activity2Id: number }) => {
            const res = await fetch('/api/activities/merge/approve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ activity1Id, activity2Id })
            })
            if (!res.ok) throw new Error('Failed to approve')
            return res.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['merge-candidates'] })
            toast.success('Activities merged successfully')
        },
        onError: () => {
            toast.error('Failed to merge activities')
        }
    })

    const rejectMutation = useMutation({
        mutationFn: async (activityId: number) => {
            const res = await fetch('/api/activities/merge/reject', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ activityId })
            })
            if (!res.ok) throw new Error('Failed to reject')
            return res.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['merge-candidates'] })
            toast.success('Kept activities separate')
        },
        onError: () => {
            toast.error('Failed to update')
        }
    })

    const formatDistance = (meters: number) => (meters / 1000).toFixed(2) + ' km'
    const formatDuration = (seconds: number) => {
        const mins = Math.floor(seconds / 60)
        const secs = seconds % 60
        return `${mins}:${secs.toString().padStart(2, '0')}`
    }

    if (isLoading) {
        return <div className="p-8">Loading...</div>
    }

    const pairs: MergePair[] = mergePairs?.pairs || []

    return (
        <div className="container mx-auto p-6 space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Activity Merge Review</h1>
                <p className="text-muted-foreground">Review and approve potential duplicate activities</p>
            </div>

            {pairs.length === 0 ? (
                <Card>
                    <CardContent className="p-8 text-center text-muted-foreground">
                        No pending merge candidates
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-4">
                    {pairs.map((pair, idx) => (
                        <Card key={idx}>
                            <CardHeader>
                                <div className="flex items-center justify-between">
                                    <CardTitle className="text-lg">Potential Duplicate</CardTitle>
                                    <Badge variant={
                                        pair.confidence === 'high' ? 'default' :
                                            pair.confidence === 'medium' ? 'secondary' : 'outline'
                                    }>
                                        {pair.confidence} confidence ({pair.confidenceScore}%)
                                    </Badge>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="grid md:grid-cols-2 gap-6">
                                    {/* Activity 1 */}
                                    <div className="space-y-3 p-4 border rounded-lg">
                                        <div className="flex items-center gap-2">
                                            <ActivityIcon className="h-4 w-4 text-blue-500" />
                                            <span className="font-semibold text-sm uppercase">{pair.activity.source}</span>
                                        </div>
                                        <div>
                                            <div className="font-medium">{pair.activity.activity_name}</div>
                                            <div className="text-sm text-muted-foreground">
                                                {format(new Date(pair.activity.start_time), 'PPp')}
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 text-sm">
                                            <div>
                                                <div className="text-muted-foreground">Distance</div>
                                                <div className="font-medium">{formatDistance(pair.activity.distance_meters)}</div>
                                            </div>
                                            <div>
                                                <div className="text-muted-foreground">Duration</div>
                                                <div className="font-medium">{formatDuration(pair.activity.duration_seconds)}</div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Activity 2 */}
                                    <div className="space-y-3 p-4 border rounded-lg">
                                        <div className="flex items-center gap-2">
                                            <ActivityIcon className="h-4 w-4 text-orange-500" />
                                            <span className="font-semibold text-sm uppercase">{pair.matchActivity.source}</span>
                                        </div>
                                        <div>
                                            <div className="font-medium">{pair.matchActivity.activity_name}</div>
                                            <div className="text-sm text-muted-foreground">
                                                {format(new Date(pair.matchActivity.start_time), 'PPp')}
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 text-sm">
                                            <div>
                                                <div className="text-muted-foreground">Distance</div>
                                                <div className="font-medium">{formatDistance(pair.matchActivity.distance_meters)}</div>
                                            </div>
                                            <div>
                                                <div className="text-muted-foreground">Duration</div>
                                                <div className="font-medium">{formatDuration(pair.matchActivity.duration_seconds)}</div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex gap-3 mt-6">
                                    <Button
                                        onClick={() => approveMutation.mutate({
                                            activity1Id: pair.activity.id,
                                            activity2Id: pair.matchActivity.id
                                        })}
                                        disabled={approveMutation.isPending || rejectMutation.isPending}
                                        className="flex-1"
                                    >
                                        <CheckCircle2 className="h-4 w-4 mr-2" />
                                        Approve Merge
                                    </Button>
                                    <Button
                                        variant="outline"
                                        onClick={() => rejectMutation.mutate(pair.activity.id)}
                                        disabled={approveMutation.isPending || rejectMutation.isPending}
                                        className="flex-1"
                                    >
                                        <XCircle className="h-4 w-4 mr-2" />
                                        Keep Separate
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    )
}
