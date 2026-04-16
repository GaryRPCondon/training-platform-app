/**
 * POST /api/activities/[id]/generate-summary
 *
 * Triggers AI summary generation for a matched activity.
 * Returns 202 immediately; the UI polls /summary-status for completion.
 *
 * If a summary already exists, returns 200 with the existing payload unless
 * `force: true` is passed (explicit regenerate). If generation is already in
 * progress, returns 202 without starting a new one (race protection).
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateActivitySummary } from '@/lib/activities/ai-summary'
import { z } from 'zod'

const bodySchema = z.object({ force: z.boolean().optional() })

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const activityId = parseInt(id, 10)
    if (isNaN(activityId)) {
      return NextResponse.json({ error: 'Invalid activity ID' }, { status: 400 })
    }

    const rawBody = await request.json().catch(() => ({}))
    const parsed = bodySchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
    }
    const force = parsed.data.force ?? false

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify ownership and fetch current summary state
    const { data: activity } = await supabase
      .from('activities')
      .select('id, planned_workout_id, athlete_id, ai_summary_status, ai_summary, ai_star_rating, ai_summary_generated_at')
      .eq('id', activityId)
      .eq('athlete_id', user.id)
      .single()

    if (!activity) {
      return NextResponse.json({ error: 'Activity not found' }, { status: 404 })
    }

    if (!activity.planned_workout_id) {
      return NextResponse.json(
        { error: 'Activity is not linked to a planned workout' },
        { status: 400 },
      )
    }

    // Race protection: another generation is already running
    if (activity.ai_summary_status === 'pending') {
      return NextResponse.json({ status: 'pending' }, { status: 202 })
    }

    // Cache protection: return existing summary unless caller explicitly asked to regenerate
    if (activity.ai_summary_status === 'generated' && !force) {
      return NextResponse.json({
        status: 'generated',
        ai_summary: activity.ai_summary,
        ai_star_rating: activity.ai_star_rating,
        ai_summary_generated_at: activity.ai_summary_generated_at,
      })
    }

    // Check if AI summaries are enabled
    const { data: athlete } = await supabase
      .from('athletes')
      .select('ai_summaries_enabled')
      .eq('id', user.id)
      .single()

    if (!athlete?.ai_summaries_enabled) {
      return NextResponse.json(
        { error: 'AI summaries are not enabled. Enable them in your AI Configuration settings.' },
        { status: 403 },
      )
    }

    // Set pending status immediately
    await supabase
      .from('activities')
      .update({ ai_summary_status: 'pending' })
      .eq('id', activityId)

    // Fire generation in background — don't await before responding
    generateActivitySummary(supabase, activityId).catch(err => {
      console.error(`[Generate Summary] Background generation failed for activity ${activityId}:`, err)
    })

    return NextResponse.json({ status: 'pending' }, { status: 202 })
  } catch (error) {
    console.error('Generate summary error:', error)
    return NextResponse.json(
      { error: 'Failed to trigger summary generation' },
      { status: 500 },
    )
  }
}
