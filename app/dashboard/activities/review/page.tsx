import { createClient } from '@/lib/supabase/server'
import { MergeReviewList } from '@/components/activities/merge-review-list'

export default async function MergeReviewPage() {
    const supabase = await createClient()

    // Fetch flags of type 'merge_conflict'
    const { data: flags } = await supabase
        .from('workout_flags')
        .select(`
            id,
            flag_data,
            activity:activities!activity_id (*)
        `)
        .eq('flag_type', 'merge_conflict')

    // For each flag, fetch the potential match activity
    const conflicts = await Promise.all((flags || []).map(async (flag) => {
        const matchId = flag.flag_data.potential_match_id
        const { data: match } = await supabase
            .from('activities')
            .select('*')
            .eq('id', matchId)
            .single()

        // Join returns array, extract first element
        const activity = Array.isArray(flag.activity) ? flag.activity[0] : flag.activity

        return {
            flag_id: flag.id,
            activity,
            potential_match: match,
            confidence_score: flag.flag_data.confidence_score
        }
    }))

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold tracking-tight">Review Merges</h1>
            </div>

            <MergeReviewList conflicts={conflicts} />
        </div>
    )
}
