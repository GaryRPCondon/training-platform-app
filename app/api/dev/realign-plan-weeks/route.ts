/**
 * Dev-only: re-map an existing plan's remaining weeks onto race-aligned template rows.
 *
 * Plans generated before `lib/plans/align-template-weeks.ts` existed were front-anchored:
 * the LLM was handed all 18 template rows labelled Week 1..18 with no rule for which to
 * drop, so a 15-week plan ran template plan_week 1-14 and lost 15-17 — the sharpening
 * weeks — off the tail. Every session then sat three weeks behind where the author
 * intended, and the fortnight before the race carried peak work instead of a taper.
 *
 * This recomputes the correct mapping and re-stamps the Q sessions of the weeks from
 * `fromWeek` onward, copying content from the workout elsewhere in the plan that already
 * carries the prescription (so structured_workout, distances and paces survive intact
 * — there is no notation parser that could rebuild them). Template rows the plan never
 * generated are reported as `needs_generation` rather than guessed at.
 *
 * Easy days are NOT touched: their per-week km deltas are reported instead, because
 * rewriting a machine-written description like "Easy 10 km with strides" to a new
 * distance cannot be done without parsing it.
 *
 * GET (default) → dry run, writes nothing.
 * GET ?apply=true → commits the changes.
 *
 * Disabled (404) when NODE_ENV !== 'development'.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { loadFullTemplate } from '@/lib/templates/template-loader'
import {
  alignTemplateWeeksForPlan,
  hasPrescribedPerWeekRows,
  hasPrescribedWork,
} from '@/lib/plans/align-template-weeks'
import type { WeekSchedule } from '@/lib/templates/types'
import {
  buildNotationSystemPrompt,
  buildNotationUserMessage,
  parseBuiltSessions,
  buildEmitSessionsTool,
  buildPlainSteadyRun,
  buildRetryUserMessage,
  EMIT_TOOL_NAME,
  type NotationSession,
} from '@/lib/plans/build-sessions-from-notation'
import { createLLMProvider } from '@/lib/agent/factory'
import { writeLLMLog } from '@/lib/agent/llm-logger'
import type { TrainingPaces } from '@/lib/training/vdot'

/** Lowercase and strip whitespace so "8E + 4 × (4 min I…)" matches however the
 *  generator spaced it. Deliberately no regex — this runs in the app. */
function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().split(' ').join('')
}

/** Content fields a re-stamp carries over; everything else (dates, indices, status,
 *  completion and Garmin bookkeeping) stays with the destination row. */
type Content = {
  workout_type: string
  description: string | null
  distance_target_meters: number | null
  duration_target_seconds: number | null
  intensity_target: string | null
  structured_workout: unknown
}

type Workout = Content & {
  id: number
  weekly_plan_id: number | null
  workout_index: string | null
  scheduled_date: string
  completion_status: string
  completed_activity_id: number | null
  garmin_sync_status: string | null
}

export async function GET(request: Request) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const params = new URL(request.url).searchParams
  const apply = params.get('apply') === 'true'
  const fromWeek = Number(params.get('fromWeek') ?? '1')
  if (!Number.isInteger(fromWeek) || fromWeek < 1) {
    return NextResponse.json({ error: 'fromWeek must be a positive integer' }, { status: 400 })
  }
  const planIdParam = params.get('planId')
  // Opt-in: makes ONE LLM call to build the sessions this plan never generated.
  const build = params.get('build') === 'true'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const planQuery = supabase
    .from('training_plans')
    .select('id, name, template_id, start_date, end_date, training_paces')
    .eq('athlete_id', user.id)
  const { data: plan } = planIdParam
    ? await planQuery.eq('id', Number(planIdParam)).maybeSingle()
    : await planQuery.eq('status', 'active').order('created_at', { ascending: false }).limit(1).maybeSingle()

  if (!plan) return NextResponse.json({ error: 'No plan found' }, { status: 404 })
  if (!plan.template_id) {
    return NextResponse.json({ error: 'Plan has no template_id — nothing to align to' }, { status: 422 })
  }

  const template = await loadFullTemplate(plan.template_id)
  if (!hasPrescribedPerWeekRows(template)) {
    return NextResponse.json(
      { error: `Template ${plan.template_id} has no prescribed per-week rows; alignment does not apply` },
      { status: 422 }
    )
  }

  // ---- Load the plan's weeks and workouts ---------------------------------
  const { data: phases } = await supabase
    .from('training_phases').select('id').eq('plan_id', plan.id)
  const phaseIds = (phases ?? []).map(p => p.id)
  const { data: weeks } = await supabase
    .from('weekly_plans').select('id, week_number').in('phase_id', phaseIds)
  const planWeeks = (weeks ?? []).filter(w => w.week_number > 0)
  if (planWeeks.length === 0) {
    return NextResponse.json({ error: 'Plan has no numbered weeks' }, { status: 422 })
  }
  const weeksTotal = Math.max(...planWeeks.map(w => w.week_number))
  const weekNumberById = new Map(planWeeks.map(w => [w.id, w.week_number]))

  const { data: rawWorkouts } = await supabase
    .from('planned_workouts')
    .select('id, weekly_plan_id, workout_index, scheduled_date, workout_type, description, distance_target_meters, duration_target_seconds, intensity_target, structured_workout, completion_status, completed_activity_id, garmin_sync_status')
    .in('weekly_plan_id', planWeeks.map(w => w.id))
    .order('scheduled_date', { ascending: true })
  const workouts = (rawWorkouts ?? []) as Workout[]

  // ---- Mappings ------------------------------------------------------------
  // Rows as the plan was generated against (front-anchored, race week excluded),
  // and the same rows race-aligned to this plan's length.
  const authored = (template.weekly_schedule ?? [])
    .filter(w => typeof w.plan_week === 'number' && typeof w.total_km === 'number')
    .filter(hasPrescribedWork)
    .sort((a, b) => (a.plan_week ?? 0) - (b.plan_week ?? 0))
  const aligned = alignTemplateWeeksForPlan(template, weeksTotal)

  const weekWorkouts = (week: number): Workout[] =>
    workouts.filter(w => weekNumberById.get(w.weekly_plan_id ?? -1) === week)

  /** Every workout in the plan whose description carries this prescription. */
  const carriers = (prescription: string | undefined): Workout[] => {
    const needle = norm(prescription)
    if (!needle) return []
    return workouts.filter(w => norm(w.description).includes(needle))
  }

  /** The Q slots of `row` this plan week can be seen to be running. */
  const slotsMatched = (week: number, row: WeekSchedule): Array<'Q1' | 'Q2'> =>
    (['Q1', 'Q2'] as const).filter(slot =>
      carriers(row[slot]).some(w => weekNumberById.get(w.weekly_plan_id ?? -1) === week)
    )

  // Which authored row each plan week is currently running, detected from the
  // descriptions themselves rather than assumed. Scored rather than first-match:
  // some Q strings repeat across rows (JD 41-55 uses the same Q2 in plan_week 4
  // and 6), and the generator sometimes rewords a prescription ("steady E run of
  // 100-120 min" → "Steady Easy run of 100-120 min"), so a single hit is not proof.
  // Ties go to the row nearest this week's own number.
  const detected = new Map<number, number>()
  for (const week of planWeeks.map(w => w.week_number).sort((a, b) => a - b)) {
    let best: { row: number; score: number } | null = null
    for (const row of authored) {
      const score = slotsMatched(week, row).length
      if (score === 0) continue
      const planWeek = row.plan_week as number
      const better = !best || score > best.score ||
        (score === best.score && Math.abs(planWeek - week) < Math.abs(best.row - week))
      if (better) best = { row: planWeek, score }
    }
    if (best) detected.set(week, best.row)
  }

  // Workout types a template Q slot can occupy — used only as an unambiguous
  // last resort when the generator's rewording defeats the description match.
  const Q_TYPES = new Set(['long_run', 'tempo', 'intervals'])

  const changes: Array<Record<string, unknown>> = []
  const needsGeneration: Array<Record<string, unknown>> = []
  const skipped: Array<Record<string, unknown>> = []
  const easyDeltas: Array<Record<string, unknown>> = []

  for (let week = fromWeek; week <= Math.min(weeksTotal, aligned.length); week++) {
    const target = aligned[week - 1]
    const currentRow = authored.find(r => r.plan_week === detected.get(week))

    const easyNow = currentRow?.E_days_total_km
    if (easyNow !== undefined && target.E_days_total_km !== undefined && easyNow !== target.E_days_total_km) {
      easyDeltas.push({
        plan_week: week,
        easy_km_now: easyNow,
        easy_km_target: target.E_days_total_km,
        note: 'Easy-day distances are left untouched — adjust by hand if you want the exact weekly total.',
      })
    }

    // Resolve both destinations up front so the fallback below can tell whether an
    // unmatched slot has exactly one unclaimed Q workout to pair with.
    const byDescription = new Map<'Q1' | 'Q2', Workout | undefined>(
      (['Q1', 'Q2'] as const).map(slot => [
        slot,
        currentRow
          ? carriers(currentRow[slot]).find(w => weekNumberById.get(w.weekly_plan_id ?? -1) === week)
          : undefined,
      ])
    )
    const claimed = new Set([...byDescription.values()].filter(Boolean).map(w => w!.id))
    const unclaimedQ = weekWorkouts(week).filter(w => Q_TYPES.has(w.workout_type) && !claimed.has(w.id))
    const unmatchedSlots = (['Q1', 'Q2'] as const).filter(s => target[s] && !byDescription.get(s))
    if (unmatchedSlots.length === 1 && unclaimedQ.length === 1) {
      byDescription.set(unmatchedSlots[0], unclaimedQ[0])
    }

    for (const slot of ['Q1', 'Q2'] as const) {
      const prescription = target[slot]
      if (!prescription) continue

      const destination = byDescription.get(slot)
      if (!destination) {
        needsGeneration.push({
          plan_week: week, slot, template_plan_week: target.source_plan_week, prescription,
          reason: 'could not identify which workout in this plan week holds this slot',
        })
        continue
      }
      if (destination.completion_status !== 'pending' || destination.completed_activity_id !== null) {
        skipped.push({
          plan_week: week, slot, workout_id: destination.id,
          workout_index: destination.workout_index, scheduled_date: destination.scheduled_date,
          reason: `already ${destination.completion_status}`,
        })
        continue
      }

      // The workout elsewhere in the plan that already carries the target prescription.
      const donor = carriers(prescription)[0]
      if (!donor) {
        needsGeneration.push({
          plan_week: week, slot, template_plan_week: target.source_plan_week, prescription,
          workout_id: destination.id, workout_index: destination.workout_index,
          scheduled_date: destination.scheduled_date,
          current_description: destination.description,
          reason: target[`${slot}_is_session`] === false
            ? 'plain steady run — no structured session to copy; adjust the duration/distance by hand'
            : 'this plan never generated the target template row — no structured_workout to copy',
        })
        continue
      }
      if (donor.id === destination.id) continue  // already correct

      changes.push({
        plan_week: week, slot, template_plan_week: target.source_plan_week,
        workout_id: destination.id, workout_index: destination.workout_index,
        scheduled_date: destination.scheduled_date,
        donor_workout_id: donor.id, donor_scheduled_date: donor.scheduled_date,
        description_before: destination.description, description_after: donor.description,
        distance_before_m: destination.distance_target_meters,
        distance_after_m: donor.distance_target_meters,
      })

      if (apply) {
        const { error } = await supabase
          .from('planned_workouts')
          .update({
            workout_type: donor.workout_type,
            description: donor.description,
            distance_target_meters: donor.distance_target_meters,
            duration_target_seconds: donor.duration_target_seconds,
            intensity_target: donor.intensity_target,
            structured_workout: donor.structured_workout,
            // Whatever is on the watch is now the wrong session.
            garmin_sync_status: destination.garmin_sync_status === 'synced' ? 'stale' : destination.garmin_sync_status,
          })
          .eq('id', destination.id)
          .eq('athlete_id', user.id)
        if (error) {
          return NextResponse.json(
            { error: `Failed to update workout ${destination.id}: ${error.message}`, changes },
            { status: 500 }
          )
        }
      }
    }
  }

  // ---- Optionally build the sessions that have no donor anywhere in the plan ----
  const builtSessions: Array<Record<string, unknown>> = []
  const buildErrors: string[] = []
  let buildRaw: string | undefined
  let buildRawLength: number | undefined
  const buildable = needsGeneration.filter(n => typeof n.workout_id === 'number')

  if (build && buildable.length > 0) {
    const requested: NotationSession[] = buildable.map(n => {
      const row = aligned[(n.plan_week as number) - 1]
      const slot = n.slot as 'Q1' | 'Q2'
      return {
        key: String(n.workout_id),
        prescription: n.prescription as string,
        workout_type: row[`${slot}_type`] ?? 'easy_run',
        km: row[`${slot}_km`] as number,
        mileage: row[`${slot}_mileage`],
        warmup_cooldown: row[`${slot}_warmup_cooldown`],
        is_session: row[`${slot}_is_session`],
      }
    })

    // Plain steady runs need no model: the template states the distance its
    // duration implies, and asking produced the bottom of the range instead.
    const plain = requested.filter(r => r.is_session === false)
    const forModel = requested.filter(r => r.is_session !== false)
    const allBuilt = plain.map(buildPlainSteadyRun)

    // The plan writes Q slots as "Q1: …" / "Q2: …"; the model does not know that.
    const slotOf = new Map(buildable.map(n => [String(n.workout_id), n.slot as string]))
    const describe = (id: number, text: string): string => {
      const slot = slotOf.get(String(id))
      return slot && !text.startsWith(slot) ? `${slot}: ${text}` : text
    }

    const { data: athlete } = await supabase
      .from('athletes').select('preferred_llm_provider').eq('id', user.id).maybeSingle()
    const providerName = athlete?.preferred_llm_provider || 'deepseek'
    const provider = createLLMProvider(providerName)
    const systemPrompt = buildNotationSystemPrompt(template)
    const userPrompt = buildNotationUserMessage(forModel)

    // Forced single tool → schema-enforced output. Asking for "JSON only" in the
    // prompt was not enough: Gemini replied with a markdown coaching document.
    const tool = buildEmitSessionsTool()
    const response = await provider.generateResponse({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      tools: [tool],
      toolChoice: { type: 'function', function: { name: EMIT_TOOL_NAME } },
      maxTokens: 8000,
      temperature: 0.2,
      disableThinking: true,
    })
    const emitted = response.toolCalls?.find(t => t.name === EMIT_TOOL_NAME)?.arguments
    writeLLMLog('realign-build-sessions', {
      provider: providerName, planId: plan.id, requested,
      systemPrompt, userPrompt, rawResponse: response.content,
    })

    const paces = (plan.training_paces as TrainingPaces | null) ?? null
    const first = parseBuiltSessions(emitted ?? response.content, forModel, paces)
    allBuilt.push(...first.built)
    if (first.rawResponse !== undefined) {
      console.error('[Realign] Session build response was unreadable. Raw:', first.rawResponse.slice(0, 2000))
      buildRaw = first.rawResponse.slice(0, 2000)
      buildRawLength = first.rawResponse.length
    }

    // One corrective retry. The consistent failure is dropped easy volume — only the
    // reps get built — so quote back what the structure summed to and re-ask.
    const stillFailing = first.rejected ?? []
    if (stillFailing.length > 0) {
      const retry = await provider.generateResponse({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
          { role: 'assistant', content: JSON.stringify(emitted ?? {}) },
          { role: 'user', content: buildRetryUserMessage(forModel, stillFailing) },
        ],
        tools: [tool],
        toolChoice: { type: 'function', function: { name: EMIT_TOOL_NAME } },
        maxTokens: 8000,
        temperature: 0.2,
        disableThinking: true,
      })
      const retryEmitted = retry.toolCalls?.find(t => t.name === EMIT_TOOL_NAME)?.arguments
      const retryWanted = forModel.filter(f => stillFailing.some(r => r.key === f.key))
      const second = parseBuiltSessions(retryEmitted ?? retry.content, retryWanted, paces)
      allBuilt.push(...second.built)
      buildErrors.push(...second.errors)
      writeLLMLog('realign-build-sessions-retry', {
        provider: providerName, planId: plan.id, retryWanted,
        rawResponse: retry.content, emitted: retryEmitted,
      })
    }
    // Only report first-pass errors for sessions the retry did not rescue.
    const rescued = new Set(allBuilt.map(b => b.key))
    buildErrors.unshift(...first.errors.filter(e => !rescued.has(e.split(':')[0])))

    const built = allBuilt
    // A slot that was built no longer needs generating.
    const builtIds = new Set(built.map(b => Number(b.key)))
    for (let i = needsGeneration.length - 1; i >= 0; i--) {
      if (builtIds.has(needsGeneration[i].workout_id as number)) needsGeneration.splice(i, 1)
    }

    for (const b of built) {
      const id = Number(b.key)
      const dest = workouts.find(w => w.id === id)
      builtSessions.push({
        workout_id: id,
        workout_index: dest?.workout_index,
        scheduled_date: dest?.scheduled_date,
        description_before: dest?.description,
        description_after: describe(id, b.description),
        distance_before_m: dest?.distance_target_meters,
        distance_after_m: b.distance_target_meters,
      })
      if (apply) {
        const { error } = await supabase
          .from('planned_workouts')
          .update({
            description: describe(id, b.description),
            intensity_target: b.intensity,
            distance_target_meters: b.distance_target_meters,
            structured_workout: b.structured_workout,
            // undefined means "leave whatever the plan already has"
            ...(b.duration_target_seconds !== undefined
              ? { duration_target_seconds: b.duration_target_seconds }
              : {}),
            garmin_sync_status: dest?.garmin_sync_status === 'synced' ? 'stale' : dest?.garmin_sync_status,
          })
          .eq('id', id)
          .eq('athlete_id', user.id)
        if (error) {
          return NextResponse.json(
            { error: `Failed to write built session ${id}: ${error.message}`, changes, builtSessions },
            { status: 500 }
          )
        }
      }
    }
  }

  const summarise = (rows: WeekSchedule[]) =>
    rows.map((r, i) => ({ plan_week: i + 1, template_plan_week: r.source_plan_week }))

  return NextResponse.json({
    plan_id: plan.id,
    plan_name: plan.name,
    template_id: plan.template_id,
    weeks_total: weeksTotal,
    from_week: fromWeek,
    applied: apply,
    current_mapping_detected: [...detected.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([plan_week, template_plan_week]) => ({ plan_week, template_plan_week })),
    target_mapping: summarise(aligned),
    changes,
    needs_generation: needsGeneration,
    skipped,
    easy_day_deltas: easyDeltas,
    built_sessions: build ? builtSessions : undefined,
    build_errors: build && buildErrors.length > 0 ? buildErrors : undefined,
    build_raw_response: buildRaw,
    build_raw_response_length: buildRawLength,
    warning: needsGeneration.length > 0
      ? 'Slots still listed under needs_generation keep the content they already had, which may now duplicate a week that moved earlier. Re-run with &build=true to have them built from the template notation, or fix them by hand. Re-push anything touched to Garmin.'
      : undefined,
  })
}
