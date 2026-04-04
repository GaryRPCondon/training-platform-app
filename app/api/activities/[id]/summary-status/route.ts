/**
 * GET /api/activities/[id]/summary-status
 *
 * Polling endpoint for AI summary generation status.
 * The UI polls this every 3s after triggering generation.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const activityId = parseInt(id, 10)
    if (isNaN(activityId)) {
      return NextResponse.json({ error: 'Invalid activity ID' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: activity } = await supabase
      .from('activities')
      .select('ai_summary_status, ai_summary, ai_star_rating, ai_summary_generated_at')
      .eq('id', activityId)
      .eq('athlete_id', user.id)
      .single()

    if (!activity) {
      return NextResponse.json({ error: 'Activity not found' }, { status: 404 })
    }

    return NextResponse.json({
      status: activity.ai_summary_status,
      ai_summary: activity.ai_summary,
      ai_star_rating: activity.ai_star_rating,
      ai_summary_generated_at: activity.ai_summary_generated_at,
    })
  } catch (error) {
    console.error('Summary status error:', error)
    return NextResponse.json({ error: 'Failed to fetch summary status' }, { status: 500 })
  }
}
