'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Check, X, ArrowRightLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'

interface MergeConflict {
    flag_id: number
    activity: any
    potential_match: any
    confidence_score: number
}

export function MergeReviewList({ conflicts }: { conflicts: MergeConflict[] }) {
    const [processingId, setProcessingId] = useState<number | null>(null)
    const router = useRouter()
    const supabase = createClient()

    const handleMerge = async (conflict: MergeConflict) => {
        setProcessingId(conflict.flag_id)
        try {
            // 1. Update the potential match (the one we keep) with data from the new activity
            const { error: updateError } = await supabase
                .from('activities')
                .update({
                    // If source was Garmin, update Garmin ID, etc.
                    [conflict.activity.source === 'garmin' ? 'garmin_id' : 'strava_id']:
                        conflict.activity.source === 'garmin' ? conflict.activity.garmin_id : conflict.activity.strava_id,
                    [conflict.activity.source === 'garmin' ? 'synced_from_garmin' : 'synced_from_strava']: new Date().toISOString(),
                    source: 'merged'
                })
                .eq('id', conflict.potential_match.id)

            if (updateError) throw updateError

            // 2. Delete the temporary conflicting activity
            const { error: deleteError } = await supabase
                .from('activities')
                .delete()
                .eq('id', conflict.activity.id)

            if (deleteError) throw deleteError

            // 3. Delete the flag
            await supabase.from('workout_flags').delete().eq('id', conflict.flag_id)

            toast.success('Activities merged successfully')
            router.refresh()
        } catch (error) {
            console.error('Merge failed:', error)
            toast.error('Failed to merge activities')
        } finally {
            setProcessingId(null)
        }
    }

    const handleKeepSeparate = async (conflict: MergeConflict) => {
        setProcessingId(conflict.flag_id)
        try {
            // Just delete the flag, keeping both activities
            await supabase.from('workout_flags').delete().eq('id', conflict.flag_id)

            // Optionally update merge_status to 'ignored' on the activity
            await supabase
                .from('activities')
                .update({ merge_status: 'ignored' })
                .eq('id', conflict.activity.id)

            toast.success('Activities kept separate')
            router.refresh()
        } catch (error) {
            toast.error('Failed to update')
        } finally {
            setProcessingId(null)
        }
    }

    if (conflicts.length === 0) {
        return (
            <div className="text-center py-12">
                <p className="text-muted-foreground">No pending merge conflicts.</p>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            {conflicts.map((conflict) => (
                <Card key={conflict.flag_id}>
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <CardTitle className="flex items-center gap-2">
                                <ArrowRightLeft className="h-5 w-5 text-orange-500" />
                                Potential Match Found
                            </CardTitle>
                            <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">
                                {Math.round(conflict.confidence_score)}% Confidence
                            </Badge>
                        </div>
                        <CardDescription>
                            We found a similar activity that might be a duplicate.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="p-4 border rounded-lg bg-muted/50">
                                <h4 className="font-medium mb-2 capitalize">{conflict.activity.source} (New)</h4>
                                <div className="space-y-1 text-sm">
                                    <p>{conflict.activity.activity_name}</p>
                                    <p>{new Date(conflict.activity.start_time).toLocaleString()}</p>
                                    <p>{(conflict.activity.distance_meters / 1000).toFixed(2)} km</p>
                                    <p>{Math.floor(conflict.activity.duration_seconds / 60)} min</p>
                                </div>
                            </div>
                            <div className="p-4 border rounded-lg">
                                <h4 className="font-medium mb-2 capitalize">{conflict.potential_match.source} (Existing)</h4>
                                <div className="space-y-1 text-sm">
                                    <p>{conflict.potential_match.activity_name}</p>
                                    <p>{new Date(conflict.potential_match.start_time).toLocaleString()}</p>
                                    <p>{(conflict.potential_match.distance_meters / 1000).toFixed(2)} km</p>
                                    <p>{Math.floor(conflict.potential_match.duration_seconds / 60)} min</p>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                    <CardFooter className="flex justify-end gap-2">
                        <Button
                            variant="outline"
                            onClick={() => handleKeepSeparate(conflict)}
                            disabled={processingId === conflict.flag_id}
                        >
                            <X className="mr-2 h-4 w-4" />
                            Keep Separate
                        </Button>
                        <Button
                            onClick={() => handleMerge(conflict)}
                            disabled={processingId === conflict.flag_id}
                        >
                            <Check className="mr-2 h-4 w-4" />
                            Merge Activities
                        </Button>
                    </CardFooter>
                </Card>
            ))}
        </div>
    )
}
