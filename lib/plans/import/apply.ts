import { addDays, format, parseISO } from 'date-fns'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AllTrainingPaces } from '@/lib/training/vdot'
import { RACE_DISTANCES, type RaceDistance } from '@/lib/training/vdot'
import type { ParsedPlan, ParsedWorkout } from '@/lib/plans/response-parser'
import { writePlanToDatabase } from '@/lib/plans/plan-writer'
import {
  ParsedRunningPlan,
  ImportedWeek,
  ImportedWorkout,
  FitMode,
} from '@/lib/plans/import/schemas'
import { intensityToPaceKey } from '@/lib/plans/import/intensity'
import { resolveImportPace } from '@/lib/plans/import/pace'
import { computeWeeksAvailable, fitWeeksToWindow } from '@/lib/plans/import/fit'

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/** Map a user-facing race distance string onto a canonical RaceDistance key. */
export function normalizeRaceDistance(raw: string): RaceDistance | null {
  const s = raw.trim().toLowerCase().split(' ').filter(Boolean).join('_')
  const table: Record<string, RaceDistance> = {
    mile: 'mile',
    '1_mile': 'mile',
    '3k': '3k',
    '5k': '5k',
    '10k': '10k',
    '15k': '15k',
    '10_mile': '10_mile',
    '10_miler': '10_mile',
    half: 'half_marathon',
    half_marathon: 'half_marathon',
    halfmarathon: 'half_marathon',
    full: 'marathon',
    marathon: 'marathon',
  }
  return table[s] ?? null
}

/**
 * Ensure the final week contains a race workout and return the race day (1-7).
 * If the source plan didn't mark one, append a race on Sunday (day 7).
 */
export function ensureRaceWorkout(
  weeks: ImportedWeek[],
  raceDistance: string,
): { weeks: ImportedWeek[]; raceDay: number } {
  if (weeks.length === 0) return { weeks, raceDay: 7 }
  const lastIdx = weeks.length - 1
  const last = weeks[lastIdx]
  const existing = last.workouts.find(w => w.type === 'race')
  if (existing) return { weeks, raceDay: existing.day_of_week }

  const distanceKey = normalizeRaceDistance(raceDistance)
  const distanceMeters = distanceKey ? RACE_DISTANCES[distanceKey] : null
  const raceDay = 7
  const raceWorkout: ImportedWorkout = {
    day_of_week: raceDay,
    type: 'race',
    description: `${raceDistance} race`,
    distance_meters: distanceMeters,
    intensity: 'race',
  }
  const newLast: ImportedWeek = {
    ...last,
    workouts: [
      ...last.workouts.filter(w => w.day_of_week !== raceDay),
      raceWorkout,
    ].sort((a, b) => a.day_of_week - b.day_of_week),
  }
  const out = [...weeks]
  out[lastIdx] = newLast
  return { weeks: out, raceDay }
}

/**
 * Anchor the plan to race day: the final week's race-day slot lands on raceDate;
 * earlier weeks count back in 7-day windows. planStartDate = week-1 start.
 */
export function deriveAnchorDates(
  raceDate: string,
  raceDay: number,
  fittedWeekCount: number,
): { planStartDate: string; goalDate: string } {
  const race = parseISO(raceDate)
  const finalWeekStart = addDays(race, -(raceDay - 1))
  const planStart = addDays(finalWeekStart, -(fittedWeekCount - 1) * 7)
  return {
    planStartDate: format(planStart, 'yyyy-MM-dd'),
    goalDate: raceDate,
  }
}

/**
 * Map fitted imported weeks onto the ParsedPlan shape consumed unchanged by
 * writePlanToDatabase. Pace is stamped here (literal-first, else VDOT), so the
 * writer is called with paceTargets undefined (its stamping becomes a no-op).
 */
export function buildParsedPlan(
  weeks: ImportedWeek[],
  athletePaces: AllTrainingPaces | null | undefined,
): ParsedPlan {
  return {
    weeks: weeks.map(week => {
      const totalMeters = week.workouts.reduce((s, w) => s + (w.distance_meters ?? 0), 0)
      const workouts: ParsedWorkout[] = week.workouts.map(w => {
        const isRun = w.type !== 'rest' && w.type !== 'cross_training'
        const intensityKey = w.intensity ? intensityToPaceKey(w.intensity) : 'easy'
        const resolved = isRun ? resolveImportPace(w.intensity, w.pace_literal, athletePaces) : null

        const base = (w.structured_workout ?? {}) as Record<string, unknown>
        let structured: Record<string, unknown> | null =
          Object.keys(base).length > 0 ? { ...base } : null
        if (resolved) {
          structured = {
            ...(structured ?? {}),
            target_pace_sec_per_km: resolved.target_pace_sec_per_km,
            pace_label: resolved.pace_label,
            pace_source: resolved.pace_source,
          }
        }

        return {
          day: w.day_of_week,
          workout_index: `W${week.week_index}:D${w.day_of_week}`,
          type: w.type,
          description: w.description,
          distance_meters: w.distance_meters ?? null,
          intensity: isRun ? intensityKey : '',
          pace_guidance: null,
          notes: w.notes ?? null,
          duration_seconds: w.duration_seconds ?? null,
          structured_workout: structured,
        }
      })
      return {
        week_number: week.week_index,
        phase: week.phase ?? null,
        weekly_total_km: Math.round((totalMeters / 1000) * 10) / 10,
        workouts,
      }
    }),
  }
}

// ---------------------------------------------------------------------------
// Orchestrator (persists)
// ---------------------------------------------------------------------------

export interface ApplyImportedPlanInput {
  supabase: SupabaseClient
  athleteId: string
  definition: ParsedRunningPlan
  name: string
  startDate: string
  raceDate: string
  raceDistance: string
  importedRunPlanId: number
  athletePaces?: AllTrainingPaces | null
  vdot?: number | null
}

export interface ApplyImportedPlanResult {
  planId: number
  fitMode: FitMode
  fittedWeeks: number
  weeksAvailable: number
  droppedWeekIndices: number[]
  duplicatedWeekIndices: number[]
}

export async function applyImportedPlan(
  input: ApplyImportedPlanInput,
): Promise<ApplyImportedPlanResult> {
  const { supabase, athleteId, definition, name, startDate, raceDate, raceDistance } = input

  const weeksAvailable = computeWeeksAvailable(startDate, raceDate)
  const fit = fitWeeksToWindow(definition.weeks, weeksAvailable, definition.detected_race_week ?? null)
  const { weeks, raceDay } = ensureRaceWorkout(fit.weeks, raceDistance)
  const { planStartDate, goalDate } = deriveAnchorDates(raceDate, raceDay, weeks.length)

  // Goal (race) — powers phase progress / taper detection downstream.
  const distanceKey = normalizeRaceDistance(raceDistance)
  const { data: goal, error: goalError } = await supabase
    .from('athlete_goals')
    .insert({
      athlete_id: athleteId,
      goal_type: 'race',
      goal_name: name,
      target_date: raceDate,
      target_value: { distance_meters: distanceKey ? RACE_DISTANCES[distanceKey] : null },
      status: 'active',
      priority: 1,
    })
    .select()
    .single()
  if (goalError) throw goalError

  // Draft training plan with import provenance.
  const { data: plan, error: planError } = await supabase
    .from('training_plans')
    .insert({
      athlete_id: athleteId,
      goal_id: goal.id,
      name,
      start_date: planStartDate,
      end_date: goalDate,
      plan_type: distanceKey ?? raceDistance,
      status: 'draft',
      created_by: 'import',
      source: 'import',
      imported_run_plan_id: input.importedRunPlanId,
      training_paces: input.athletePaces ?? null,
      vdot: input.vdot ?? null,
    })
    .select()
    .single()
  if (planError) throw planError

  const parsedPlan = buildParsedPlan(weeks, input.athletePaces)
  await writePlanToDatabase(parsedPlan, {
    planId: plan.id,
    planStartDate,
    goalDate,
    supabase,
    // Pace already stamped in buildParsedPlan — keep the writer's stamping off.
    paceTargets: undefined,
    athletePaces: null,
  })

  const { error: appError } = await supabase
    .from('imported_run_plan_applications')
    .insert({
      imported_run_plan_id: input.importedRunPlanId,
      training_plan_id: plan.id,
      athlete_id: athleteId,
      applied_start_date: planStartDate,
      applied_race_date: raceDate,
      fit_mode: fit.fitMode,
    })
  if (appError) throw appError

  return {
    planId: plan.id,
    fitMode: fit.fitMode,
    fittedWeeks: weeks.length,
    weeksAvailable,
    droppedWeekIndices: fit.droppedWeekIndices,
    duplicatedWeekIndices: fit.duplicatedWeekIndices,
  }
}
