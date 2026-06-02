/**
 * Resolve a methodology intensity label (e.g. "T", "I", "M") to a concrete pace
 * using the athlete's *active plan* — its template's pace_targets resolved
 * against the athlete's VDOT paces.
 *
 * This mirrors what plan generation does via plan-writer's stampResolvedPace,
 * but for workouts created outside the generation pipeline (manual "Add workout"
 * and AI-coach add/replace, both via POST /api/workouts). Those workouts are
 * standalone planned_workouts not linked to a plan, so we assume they belong to
 * the athlete's active plan's methodology.
 *
 * Returns null (caller leaves the workout unstamped, falling back to a
 * workout-type pace guess) when there's no active plan, no template/VDOT, or the
 * intensity isn't present in the template's pace_targets.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { resolvePace, type ResolvedPace } from './pace-resolver'
import { loadFullTemplate } from '@/lib/templates/template-loader'
import { calculateTrainingPaces, calculateRacePaces } from '@/lib/training/vdot'

export async function resolveActivePlanPace(
  supabase: SupabaseClient,
  athleteId: string,
  intensityLabel: string | null | undefined
): Promise<ResolvedPace | null> {
  if (!intensityLabel) return null

  const { data: plan } = await supabase
    .from('training_plans')
    .select('template_id, vdot')
    .eq('athlete_id', athleteId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!plan?.template_id || !plan.vdot) return null

  let paceTargets
  try {
    const template = await loadFullTemplate(plan.template_id)
    paceTargets = template.pace_targets
  } catch {
    return null
  }
  if (!paceTargets) return null

  const athletePaces = { ...calculateTrainingPaces(plan.vdot), ...calculateRacePaces(plan.vdot) }
  return resolvePace(intensityLabel, paceTargets, athletePaces)
}
