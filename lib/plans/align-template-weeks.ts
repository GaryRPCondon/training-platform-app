import type { FullTemplate, WeekSchedule } from '@/lib/templates/types'

const DAY_KEYS = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
] as const

/**
 * True when the row actually prescribes work in one of the shapes the prompt
 * builders can render.
 *
 * JD 2Q's race-week row (plan_week 18) keeps its content in `daily_schedule`,
 * which no prompt builder reads — rendering it produces a week of bare "Rest"
 * lines under a "generate exactly these workouts" heading, contradicting the
 * RACE WEEK GUIDANCE section built from `template.race_week`.
 */
export function hasPrescribedWork(w: WeekSchedule): boolean {
  if (w.Q1 || w.Q2) return true
  // Aggregate-only rows (km targets without the Q descriptions) still prescribe work —
  // they drive the PER-WEEK TARGETS fallback block.
  if (w.Q1_km !== undefined || w.Q2_km !== undefined || w.E_days_total_km !== undefined) return true
  if (w.E_days_distribution && w.E_days_distribution.length > 0) return true
  if (w.workouts && Object.keys(w.workouts).length > 0) return true
  return DAY_KEYS.some(d => typeof w[d] === 'string' && (w[d] as string).trim().length > 0)
}

/**
 * Fit a template's week rows onto a plan of `targetWeeks` weeks, anchored to the
 * race rather than to the start date.
 *
 * Templates are authored at a fixed length (JD 2Q: 18 weeks) but an athlete's
 * runway rarely matches. The rows nearest the end of the template are the ones
 * that must land nearest the race — sharpening and taper are defined by how far
 * out they are, not by how far in. So a short plan drops the *earliest* base
 * weeks (the athlete is already at that volume by definition of the mileage
 * bracket they selected) and a long plan repeats the earliest retained week.
 *
 * Previously the rows were handed to the LLM labelled 1..N with no rule for
 * which to drop, and it front-anchored: a 15-week plan ran template weeks 1-14
 * and lost 15-17, putting every session three weeks behind where the author
 * intended and replacing the taper with peak work.
 *
 * Returned rows are renumbered so `plan_week` is contiguous from 1 and reads
 * directly as the plan's own week number; the number they were authored as is kept
 * on `source_plan_week`. Input is not mutated.
 */
export function alignTemplateWeeks(
  rows: WeekSchedule[],
  targetWeeks: number
): WeekSchedule[] {
  const usable = [...rows]
    .map((w, i) => ({ w, order: w.plan_week ?? i + 1 }))
    .sort((a, b) => a.order - b.order)
    .map(({ w }) => w)
    .filter(hasPrescribedWork)

  if (usable.length === 0 || targetWeeks <= 0) return []

  const aligned = targetWeeks <= usable.length
    ? usable.slice(usable.length - targetWeeks)
    : [
        ...Array.from({ length: targetWeeks - usable.length }, () => usable[0]),
        ...usable,
      ]

  return aligned.map((w, i) => ({
    ...w,
    plan_week: i + 1,
    // Sticky: an already-aligned row keeps the number it was AUTHORED as.
    source_plan_week: w.source_plan_week ?? w.plan_week,
  }))
}

/**
 * True when the template supplies the per-week rows that drive the aligned
 * PER-WEEK PRESCRIBED WORKOUTS block (currently JD 2Q).
 */
export function hasPrescribedPerWeekRows(template: FullTemplate): boolean {
  return (template.weekly_schedule ?? []).some(
    w => typeof w.plan_week === 'number' && typeof w.total_km === 'number'
  )
}

/**
 * Race-align a template's prescribed per-week rows onto a plan of `weeksNeeded`
 * weeks. Returns [] for templates that carry no such rows.
 *
 * Week `weeksNeeded` always holds the race, so when the template reserves a race
 * week — either as explicit `race_week` guidance or as a content-free final row —
 * the prescribed rows cover weeks 1..weeksNeeded-1 and the race week is described
 * separately.
 */
export function alignTemplateWeeksForPlan(
  template: FullTemplate,
  weeksNeeded: number
): WeekSchedule[] {
  const prescribed = (template.weekly_schedule ?? []).filter(
    w => typeof w.plan_week === 'number' && typeof w.total_km === 'number'
  )
  if (prescribed.length === 0) return []

  const reservesRaceWeek =
    Boolean(template.race_week) || prescribed.some(w => !hasPrescribedWork(w))
  return alignTemplateWeeks(prescribed, Math.max(1, weeksNeeded - (reservesRaceWeek ? 1 : 0)))
}
