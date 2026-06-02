/**
 * Dev-only: repair planned workouts whose resolved pace stamp was stripped by
 * an earlier edit-save bug (warmup/cooldown edits used to overwrite the whole
 * structured_workout JSONB with just {warmup, main_set, cooldown}, dropping
 * target_pace_sec_per_km / pace_label and collapsing distance_target_meters to
 * main-set-only).
 *
 * Re-derives the stamp the same way plan generation does — the active plan's
 * template pace_targets resolved against the athlete's VDOT paces — and
 * recomputes distance_target_meters as the full session total.
 *
 * Scope: the athlete's active plan, corrupted workouts only (structured main_set
 * present but target_pace_sec_per_km missing, and intensity resolvable).
 *
 * Per-workout pace_guidance / free-text notes are NOT recoverable (they were
 * LLM-authored, not derived from the template) and are left absent.
 *
 * GET (default) → dry run, lists proposed changes, writes nothing.
 * GET ?apply=true → commits the changes.
 *
 * Disabled (404) when NODE_ENV !== 'development'.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { loadFullTemplate } from '@/lib/templates/template-loader'
import { resolvePace } from '@/lib/plans/pace-resolver'
import {
  calculateTrainingPaces,
  calculateRacePaces,
  calculateTotalWorkoutDistance,
} from '@/lib/training/vdot'

export async function GET(request: Request) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const apply = new URL(request.url).searchParams.get('apply') === 'true'

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // --- Active plan + its template/VDOT ---
    const { data: plan } = await supabase
      .from('training_plans')
      .select('id, template_id, vdot, status')
      .eq('athlete_id', user.id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!plan) return NextResponse.json({ error: 'No active plan found' }, { status: 404 })
    if (!plan.template_id) return NextResponse.json({ error: 'Active plan has no template_id' }, { status: 422 })
    if (!plan.vdot) return NextResponse.json({ error: 'Active plan has no VDOT' }, { status: 422 })

    const template = await loadFullTemplate(plan.template_id)
    const paceTargets = template.pace_targets
    if (!paceTargets) return NextResponse.json({ error: 'Template has no pace_targets' }, { status: 422 })

    const athletePaces = { ...calculateTrainingPaces(plan.vdot), ...calculateRacePaces(plan.vdot) }

    // --- Walk plan → phases → weekly_plans → planned_workouts ---
    const { data: phases } = await supabase
      .from('training_phases')
      .select('id')
      .eq('plan_id', plan.id)
    const phaseIds = (phases ?? []).map(p => p.id)
    if (phaseIds.length === 0) return NextResponse.json({ plan_id: plan.id, scanned: 0, repaired: [], applied: apply })

    const { data: weeks } = await supabase
      .from('weekly_plans')
      .select('id')
      .in('phase_id', phaseIds)
    const weekIds = (weeks ?? []).map(w => w.id)
    if (weekIds.length === 0) return NextResponse.json({ plan_id: plan.id, scanned: 0, repaired: [], applied: apply })

    const { data: workouts } = await supabase
      .from('planned_workouts')
      .select('id, workout_index, scheduled_date, workout_type, intensity_target, distance_target_meters, structured_workout')
      .in('weekly_plan_id', weekIds)
      .order('scheduled_date', { ascending: true })

    const repaired: Array<Record<string, unknown>> = []
    let scanned = 0

    for (const w of workouts ?? []) {
      const sw = w.structured_workout as Record<string, unknown> | null
      const hasMainSet = Array.isArray(sw?.main_set)
      if (!sw || !hasMainSet) continue
      scanned++

      // Corruption marker: structured workout but no resolved pace stamp.
      if (typeof sw.target_pace_sec_per_km === 'number') continue
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

      repaired.push({
        id: w.id,
        workout_index: w.workout_index,
        scheduled_date: w.scheduled_date,
        intensity_target: w.intensity_target,
        pace_label: resolved.pace_label,
        target_pace_sec_per_km: resolved.target_pace_sec_per_km,
        distance_before: w.distance_target_meters,
        distance_after: newDist > 0 ? newDist : w.distance_target_meters,
      })

      if (apply) {
        const update: Record<string, unknown> = { structured_workout: newSw }
        if (newDist > 0) update.distance_target_meters = newDist
        const { error } = await supabase
          .from('planned_workouts')
          .update(update)
          .eq('id', w.id)
          .eq('athlete_id', user.id)
        if (error) {
          return NextResponse.json(
            { error: `Failed to update workout ${w.id}: ${error.message}`, repaired },
            { status: 500 }
          )
        }
      }
    }

    return NextResponse.json({
      plan_id: plan.id,
      template_id: plan.template_id,
      vdot: plan.vdot,
      scanned,
      count: repaired.length,
      applied: apply,
      note: apply
        ? 'Changes committed. pace_guidance / free-text notes were not recoverable.'
        : 'Dry run — nothing written. Re-run with ?apply=true to commit.',
      repaired,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Restamp failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
