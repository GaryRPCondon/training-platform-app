/**
 * Dev-only: repair planned workouts whose distance_target_meters was inflated by
 * the old calculateTotalWorkoutDistance, which sized EVERY time-based segment at
 * interval pace unless its intensity string contained "recovery". That priced easy
 * floats inside quality sessions at I pace and turned standing rests into phantom
 * running — e.g. "Long 12 mi (19 km) — 2E + 2 × (1T w/1 min rests) + 30 min E + …"
 * was stored as 22.1 km, which then drove a false "13.1% short" on the AI summary
 * and the completion score.
 *
 * Recomputes distance_target_meters from the structure with the fixed pace-aware
 * math, rolls the corrected totals up into weekly_plans.weekly_volume_target, and
 * rescores completed workouts whose completion_metadata was measured against the
 * inflated target. Garmin compliance/accuracy fields are carried over untouched —
 * only the distance-derived fields change.
 *
 * GET (default) → dry run, lists proposed changes, writes nothing.
 * GET ?apply=true → commits the changes.
 *
 * Disabled (404) when NODE_ENV !== 'development'.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { calculateTotalWorkoutDistance, isTimePrescribedWorkout, totalPrescribedSeconds } from '@/lib/training/vdot'
import { buildScoringResult, computeComplianceScore } from '@/lib/activities/scoring'
import type { TrainingPaces } from '@/types/database'

// Below this, a change is rounding noise and not worth a write.
const MIN_DELTA_METERS = 10

export async function GET(request: Request) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const apply = new URL(request.url).searchParams.get('apply') === 'true'

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: plan } = await supabase
      .from('training_plans')
      .select('id, training_paces, status')
      .eq('athlete_id', user.id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!plan) return NextResponse.json({ error: 'No active plan found' }, { status: 404 })

    // Use the plan's stored paces — the same source loadActivePlanPaces feeds to
    // scoring and the AI summary, so the restamped values agree with both.
    const athletePaces = (plan.training_paces as TrainingPaces | null) ?? null
    if (!athletePaces) {
      return NextResponse.json({ error: 'Active plan has no training_paces' }, { status: 422 })
    }

    const { data: phases } = await supabase
      .from('training_phases')
      .select('id')
      .eq('plan_id', plan.id)
    const phaseIds = (phases ?? []).map(p => p.id)
    if (phaseIds.length === 0) {
      return NextResponse.json({ plan_id: plan.id, scanned: 0, workouts: [], weeks: [], rescored: [], applied: apply })
    }

    const { data: weeks } = await supabase
      .from('weekly_plans')
      .select('id, week_number, weekly_volume_target')
      .in('phase_id', phaseIds)
    const weekIds = (weeks ?? []).map(w => w.id)
    if (weekIds.length === 0) {
      return NextResponse.json({ plan_id: plan.id, scanned: 0, workouts: [], weeks: [], rescored: [], applied: apply })
    }

    const { data: workouts } = await supabase
      .from('planned_workouts')
      .select('id, weekly_plan_id, workout_index, scheduled_date, workout_type, distance_target_meters, duration_target_seconds, structured_workout, completed_activity_id, completion_status, completion_metadata')
      .in('weekly_plan_id', weekIds)
      .order('scheduled_date', { ascending: true })

    const changed: Array<Record<string, unknown>> = []
    const rescored: Array<Record<string, unknown>> = []
    const durationBackfill: Array<Record<string, unknown>> = []
    const complianceCleared: Array<Record<string, unknown>> = []
    // week id → corrected total metres, accumulated across every workout in the week
    // (including unchanged ones, so the rolled-up total stays truthful).
    const weekMeters = new Map<number, number>()
    let scanned = 0

    for (const w of workouts ?? []) {
      const sw = w.structured_workout as Record<string, unknown> | null
      const newDist = Array.isArray(sw?.main_set)
        ? calculateTotalWorkoutDistance(null, w.workout_type, sw, athletePaces)
        : 0
      const effective = newDist > 0 ? newDist : (w.distance_target_meters ?? 0)
      weekMeters.set(w.weekly_plan_id, (weekMeters.get(w.weekly_plan_id) ?? 0) + effective)

      // Recompute compliance from the laps once per completed workout. Both the
      // clear-bogus-compliance pass and the rescore below consume this, so a workout
      // that needs both (distance changed AND a bogus score) can't have one undo the
      // other by reading a stale stored value.
      const compliance = w.completed_activity_id
        ? computeComplianceScore(
            (await supabase
              .from('laps')
              .select('intensity_type, compliance_score')
              .eq('activity_id', w.completed_activity_id)).data ?? []
          )
        : null

      // Garmin reports a 0 (not null) compliance score on every lap when there was no
      // structured workout on the watch to compare against, and that was stored as a
      // real measurement — surfacing a red "Pace Compliance: 0%" on sessions where
      // nothing was ever measured. Derived from the laps themselves, so a genuinely
      // low-but-real score is left alone.
      const priorMeta = (w.completion_metadata ?? {}) as Record<string, unknown> & { accuracy_score?: number | null }
      if (compliance && !compliance.hasData && priorMeta.accuracy_score != null) {
        complianceCleared.push({
          id: w.id,
          workout_index: w.workout_index,
          scheduled_date: w.scheduled_date,
          accuracy_before: priorMeta.accuracy_score,
        })
        if (apply) {
          const { error } = await supabase
            .from('planned_workouts')
            .update({
              completion_metadata: {
                ...priorMeta,
                accuracy_score: null,
                compliance_lap_count: null,
                active_lap_avg_score: null,
              },
            })
            .eq('id', w.id)
            .eq('athlete_id', user.id)
          if (error) {
            return NextResponse.json({ error: `Failed to clear compliance on workout ${w.id}: ${error.message}` }, { status: 500 })
          }
        }
      }

      if (!Array.isArray(sw?.main_set)) continue
      scanned++

      // A purely time-prescribed session (all parts timed, none with a distance) has
      // no distance target of its own — give it the duration target it should always
      // have had, so completion is judged on the clock instead of a derived estimate.
      if (isTimePrescribedWorkout(sw) && w.duration_target_seconds == null) {
        const seconds = totalPrescribedSeconds(sw)
        if (seconds > 0) {
          durationBackfill.push({
            id: w.id,
            workout_index: w.workout_index,
            scheduled_date: w.scheduled_date,
            duration_target_seconds: seconds,
            prescribed_minutes: Math.round(seconds / 60),
          })
          if (apply) {
            const { error } = await supabase
              .from('planned_workouts')
              .update({ duration_target_seconds: seconds })
              .eq('id', w.id)
              .eq('athlete_id', user.id)
            if (error) {
              return NextResponse.json({ error: `Failed to set duration on workout ${w.id}: ${error.message}` }, { status: 500 })
            }
          }
        }
      }

      const oldDist = w.distance_target_meters ?? 0
      if (newDist <= 0 || Math.abs(newDist - oldDist) < MIN_DELTA_METERS) continue

      changed.push({
        id: w.id,
        workout_index: w.workout_index,
        scheduled_date: w.scheduled_date,
        workout_type: w.workout_type,
        distance_before: oldDist,
        distance_after: newDist,
        delta_percent: oldDist > 0 ? Number((((newDist - oldDist) / oldDist) * 100).toFixed(1)) : null,
      })

      if (apply) {
        const { error } = await supabase
          .from('planned_workouts')
          .update({ distance_target_meters: newDist })
          .eq('id', w.id)
          .eq('athlete_id', user.id)
        if (error) {
          return NextResponse.json({ error: `Failed to update workout ${w.id}: ${error.message}`, changed }, { status: 500 })
        }
      }

      // A completed workout's stored variance was measured against the inflated
      // target — recompute it so the calendar and observations stop reporting a
      // shortfall the athlete never had.
      if (!w.completed_activity_id) continue
      const { data: activity } = await supabase
        .from('activities')
        .select('id, distance_meters, duration_seconds')
        .eq('id', w.completed_activity_id)
        .single()
      if (!activity) continue

      // Use the compliance recomputed from this activity's laps above — reading the
      // stored score back would resurrect a bogus all-zero value the clear pass just
      // removed, since w.completion_metadata is the pre-update snapshot.
      const result = buildScoringResult(
        activity,
        { ...w, distance_target_meters: newDist },
        compliance ?? { score: 0, lapCount: 0, hasData: false, activeLapAvg: null },
        athletePaces
      )

      rescored.push({
        id: w.id,
        scheduled_date: w.scheduled_date,
        variance_before: (priorMeta.distance_variance_percent as number | null) ?? null,
        variance_after: Number(result.completionMetadata.distance_variance_percent.toFixed(1)),
        status_before: w.completion_status,
        status_after: result.completionStatus,
      })

      if (apply) {
        const { error } = await supabase
          .from('planned_workouts')
          .update({
            completion_status: result.completionStatus,
            completion_metadata: result.completionMetadata,
          })
          .eq('id', w.id)
          .eq('athlete_id', user.id)
        if (error) {
          return NextResponse.json({ error: `Failed to rescore workout ${w.id}: ${error.message}`, changed }, { status: 500 })
        }
      }
    }

    const weekChanges: Array<Record<string, unknown>> = []
    for (const week of weeks ?? []) {
      // Generation stores this as km-to-1-decimal × 1000 (deriveTotals → plan-writer),
      // so it is always a multiple of 100 m. Match that or every week picks up a
      // sub-100 m remainder the generation path would never have written.
      const total = Math.round((weekMeters.get(week.id) ?? 0) / 100) * 100
      const before = week.weekly_volume_target ?? 0
      if (Math.abs(total - before) < MIN_DELTA_METERS) continue
      weekChanges.push({ id: week.id, week_number: week.week_number, volume_before: before, volume_after: total })
      if (apply) {
        const { error } = await supabase
          .from('weekly_plans')
          .update({ weekly_volume_target: total })
          .eq('id', week.id)
        if (error) {
          return NextResponse.json({ error: `Failed to update week ${week.id}: ${error.message}`, weekChanges }, { status: 500 })
        }
      }
    }

    return NextResponse.json({
      plan_id: plan.id,
      applied: apply,
      scanned,
      workouts_changed: changed.length,
      weeks_changed: weekChanges.length,
      workouts_rescored: rescored.length,
      durations_backfilled: durationBackfill.length,
      compliance_cleared: complianceCleared.length,
      workouts: changed,
      weeks: weekChanges,
      rescored,
      duration_backfill: durationBackfill,
      compliance_clear: complianceCleared,
    })
  } catch (error) {
    console.error('[restamp-distances] failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
