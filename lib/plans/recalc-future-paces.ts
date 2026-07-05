/**
 * Opt-in re-stamp of pace targets on the athlete's FUTURE workouts when their
 * VDOT changes.
 *
 * Paces are snapshotted into planned_workouts.structured_workout at plan
 * generation (via plan-writer's stampResolvedPace). Updating VDOT afterward
 * refreshes the athlete/plan pace snapshot but NOT the already-baked per-workout
 * paces — correct by design. This helper is the explicit opt-in: "I got fitter,
 * pull my upcoming prescribed paces up to match."
 *
 * It re-derives each stamp exactly the way generation does — the active plan's
 * template pace_targets resolved against the new VDOT's paces — so fidelity is
 * identical to a fresh generation (no new pace math here). Distances are
 * recomputed as the full session total (matters for time-based workouts).
 *
 * Scope: the active plan's still-`scheduled` workouts dated today or later.
 * Completed/past/rescheduled workouts are left untouched.
 *
 * Not recomputed (same gap generation itself has): free-text pace_guidance and
 * any LLM-authored interval target_pace strings — the stamped/displayed pace
 * updates but prose may lag.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadFullTemplate } from '@/lib/templates/template-loader'
import { resolvePace } from './pace-resolver'
import {
  calculateTrainingPaces,
  calculateRacePaces,
  calculateTotalWorkoutDistance,
} from '@/lib/training/vdot'

export type RecalcSkipReason =
  | 'no_active_plan'
  | 'no_template'
  | 'no_vdot'
  | 'no_pace_targets'

export interface RecalcResult {
  /** Number of future workouts whose pace stamp was rewritten. */
  repaced: number
  /** Non-null when the recalc was a graceful no-op (e.g. imported plan). */
  skipped: RecalcSkipReason | null
}

/**
 * Re-stamp future workout paces in the athlete's active plan using its current
 * (freshly updated) VDOT. Returns a count of workouts changed, or a skip reason
 * when there's nothing to do (no active plan, imported plan with no template,
 * missing VDOT, or a template without pace_targets).
 */
export async function recalcActivePlanFuturePaces(
  supabase: SupabaseClient,
  athleteId: string,
  today: string = new Date().toISOString().slice(0, 10)
): Promise<RecalcResult> {
  const { data: plan } = await supabase
    .from('training_plans')
    .select('id, template_id, vdot, status')
    .eq('athlete_id', athleteId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!plan) return { repaced: 0, skipped: 'no_active_plan' }
  if (!plan.template_id) return { repaced: 0, skipped: 'no_template' }
  if (!plan.vdot) return { repaced: 0, skipped: 'no_vdot' }

  let paceTargets
  try {
    const template = await loadFullTemplate(plan.template_id)
    paceTargets = template.pace_targets
  } catch {
    return { repaced: 0, skipped: 'no_template' }
  }
  if (!paceTargets) return { repaced: 0, skipped: 'no_pace_targets' }

  const athletePaces = {
    ...calculateTrainingPaces(plan.vdot),
    ...calculateRacePaces(plan.vdot),
  }

  // Walk plan → phases → weekly_plans to reach the plan's workouts.
  const { data: phases } = await supabase
    .from('training_phases')
    .select('id')
    .eq('plan_id', plan.id)
  const phaseIds = (phases ?? []).map((p) => p.id)
  if (phaseIds.length === 0) return { repaced: 0, skipped: null }

  const { data: weeks } = await supabase
    .from('weekly_plans')
    .select('id')
    .in('phase_id', phaseIds)
  const weekIds = (weeks ?? []).map((w) => w.id)
  if (weekIds.length === 0) return { repaced: 0, skipped: null }

  // Future, still-scheduled workouts only — never touch past/completed ones.
  const { data: workouts } = await supabase
    .from('planned_workouts')
    .select(
      'id, workout_type, intensity_target, distance_target_meters, structured_workout, garmin_workout_id, garmin_sync_status'
    )
    .in('weekly_plan_id', weekIds)
    .gte('scheduled_date', today)
    .eq('status', 'scheduled')

  let repaced = 0

  for (const w of workouts ?? []) {
    const sw = w.structured_workout as Record<string, unknown> | null
    if (!sw || !Array.isArray(sw.main_set)) continue
    if (!w.intensity_target) continue

    const resolved = resolvePace(w.intensity_target, paceTargets, athletePaces)
    if (!resolved) continue // intensity not in template's pace_targets — can't restamp

    const newSw: Record<string, unknown> = {
      ...sw,
      target_pace_sec_per_km: resolved.target_pace_sec_per_km,
      target_pace_upper_sec_per_km: resolved.target_pace_upper_sec_per_km,
      pace_label: resolved.pace_label,
      pace_description: resolved.pace_description,
      pace_source: resolved.pace_source,
    }

    const newDist = calculateTotalWorkoutDistance(null, w.workout_type, newSw, athletePaces)

    const update: Record<string, unknown> = { structured_workout: newSw }
    if (newDist > 0) update.distance_target_meters = newDist
    // Synced Garmin workouts now hold outdated paces → mark stale for re-export.
    if (w.garmin_workout_id && w.garmin_sync_status === 'synced') {
      update.garmin_sync_status = 'stale'
    }

    const { error } = await supabase
      .from('planned_workouts')
      .update(update)
      .eq('id', w.id)
      .eq('athlete_id', athleteId)
    if (error) throw new Error(`Failed to re-pace workout ${w.id}: ${error.message}`)

    repaced++
  }

  return { repaced, skipped: null }
}
