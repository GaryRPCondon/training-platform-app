/**
 * Phase 6: Activity Detail Page
 *
 * Shows detailed view of a single activity with ability to link/unlink to workouts
 */

import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ActivityDetail } from '@/components/activities/activity-detail'

export default async function ActivityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const resolvedParams = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    notFound()
  }

  const { data: activity, error } = await supabase
    .from('activities')
    .select(`
      *,
      planned_workouts!fk_activities_planned_workout (*)
    `)
    .eq('id', resolvedParams.id)
    .eq('athlete_id', user.id)
    .single()

  if (error) {
    console.error('Activity fetch error:', error)
    console.error('Activity ID:', resolvedParams.id)
    console.error('User ID:', user.id)
  }

  if (error || !activity) {
    notFound()
  }

  return <ActivityDetail activity={activity} />
}
