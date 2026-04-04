/**
 * Fire-and-forget summary generation for matched activities.
 * Checks athlete's ai_summaries_enabled flag before generating.
 * Calls generateActivitySummary for each activity via Promise.allSettled
 * so individual failures don't affect others.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { generateActivitySummary } from '@/lib/activities/ai-summary'

export async function triggerSummaryGeneration(
  supabase: SupabaseClient,
  athleteId: string,
  activityIds: number[],
): Promise<void> {
  if (activityIds.length === 0) return

  // Check if AI summaries are enabled for this athlete
  const { data: athlete } = await supabase
    .from('athletes')
    .select('ai_summaries_enabled')
    .eq('id', athleteId)
    .single()

  if (!athlete?.ai_summaries_enabled) {
    console.log('[Trigger Summary] AI summaries disabled for athlete — skipping')
    return
  }

  const results = await Promise.allSettled(
    activityIds.map(id => generateActivitySummary(supabase, id))
  )

  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    if (result.status === 'rejected') {
      console.error(`[Trigger Summary] Failed for activity ${activityIds[i]}:`, result.reason)
    } else if (result.value) {
      console.log(`[Trigger Summary] Generated summary for activity ${activityIds[i]}: ${result.value.starRating} stars`)
    }
  }
}
