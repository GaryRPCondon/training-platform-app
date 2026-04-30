import type { ParsedPlan } from './response-parser'
import type { FullTemplate } from '@/lib/templates/types'

const HARD_TYPES = new Set(['intervals', 'tempo', 'long_run', 'race'])
const HARD_INTENSITIES = new Set([
  'hard', 'moderate', 'tempo', 'marathon', 'lactate_threshold',
  'vo2max', 'interval', 'speed', 'strength', 'race',
])

function isHard(type: string, intensity: string): boolean {
  if (HARD_TYPES.has(type)) return true
  return HARD_INTENSITIES.has((intensity ?? '').toLowerCase())
}

/**
 * Pull the set of plan_weeks where the template explicitly schedules hard
 * workouts on consecutive days. These weeks are exempt from the back-to-back
 * assertion (the template author intended that pattern).
 */
function templatePermittedB2BWeeks(template: FullTemplate): Set<number> {
  const exempt = new Set<number>()
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const
  for (let i = 0; i < (template.weekly_schedule ?? []).length; i++) {
    const w = template.weekly_schedule[i]
    const planWeek = w.plan_week ?? (i + 1)
    let prevHard = false
    for (const d of days) {
      const v = w[d]
      if (typeof v !== 'string') { prevHard = false; continue }
      const lower = v.trim().toLowerCase()
      const looksHard =
        lower.includes('tempo') || lower.includes('interval') ||
        lower.includes('long') || lower.includes('mp ') ||
        lower.includes('lt ') || lower.includes('vo2') ||
        lower.includes('strength') || lower.includes('hill')
      if (looksHard && prevHard) { exempt.add(planWeek); break }
      prevHard = looksHard
    }
  }
  return exempt
}

export function assertWeekStructure(parsedPlan: ParsedPlan, weeksNeeded: number): string[] {
  const failures: string[] = []
  if (parsedPlan.weeks.length !== weeksNeeded) {
    failures.push(`Expected ${weeksNeeded} weeks, got ${parsedPlan.weeks.length}`)
  }
  for (const week of parsedPlan.weeks) {
    const dayNumbers = new Set(week.workouts.map(w => w.day))
    for (let d = 1; d <= 7; d++) {
      if (!dayNumbers.has(d)) {
        failures.push(`Week ${week.week_number} missing day ${d}`)
      }
    }
    for (const w of week.workouts) {
      if (w.day < 1 || w.day > 7) {
        failures.push(`Week ${week.week_number} has invalid day ${w.day}`)
      }
    }
  }
  return failures
}

export function assertRaceDay(
  parsedPlan: ParsedPlan,
  weeksNeeded: number,
  raceDayNumber: number
): string[] {
  const failures: string[] = []
  const finalWeek = parsedPlan.weeks.find(w => w.week_number === weeksNeeded)
  if (!finalWeek) {
    failures.push(`Final week (W${weeksNeeded}) not generated`)
    return failures
  }
  const raceWorkout = finalWeek.workouts.find(w => w.day === raceDayNumber)
  if (!raceWorkout) {
    failures.push(`No workout on race day W${weeksNeeded}:D${raceDayNumber}`)
  } else if (raceWorkout.type !== 'race') {
    failures.push(`Race day W${weeksNeeded}:D${raceDayNumber} has type "${raceWorkout.type}", expected "race"`)
  }
  return failures
}

export function assertSessionsHaveMainSet(parsedPlan: ParsedPlan): string[] {
  const failures: string[] = []
  for (const week of parsedPlan.weeks) {
    for (const w of week.workouts) {
      if (w.type !== 'intervals' && w.type !== 'tempo') continue
      const mainSet = w.structured_workout?.main_set
      if (!Array.isArray(mainSet) || mainSet.length === 0) {
        failures.push(`${w.workout_index} (${w.type}) missing structured_workout.main_set`)
      }
    }
  }
  return failures
}

export function assertNoBackToBackHard(
  parsedPlan: ParsedPlan,
  template: FullTemplate
): string[] {
  const failures: string[] = []
  const exempt = templatePermittedB2BWeeks(template)

  // Flatten chronologically across week boundaries.
  const timeline: Array<{ week: number; day: number; type: string; intensity: string; index: string }> = []
  for (const week of [...parsedPlan.weeks].sort((a, b) => a.week_number - b.week_number)) {
    for (const w of [...week.workouts].sort((a, b) => a.day - b.day)) {
      timeline.push({ week: week.week_number, day: w.day, type: w.type, intensity: w.intensity, index: w.workout_index })
    }
  }

  for (let i = 1; i < timeline.length; i++) {
    const prev = timeline[i - 1]
    const curr = timeline[i]
    if (!isHard(prev.type, prev.intensity) || !isHard(curr.type, curr.intensity)) continue
    if (exempt.has(prev.week) || exempt.has(curr.week)) continue
    failures.push(`Back-to-back hard days: ${prev.index} (${prev.type}) → ${curr.index} (${curr.type})`)
  }
  return failures
}

export interface StructuralResult {
  blocking: string[]    // failures that should fail generation
  advisory: string[]    // soft warnings — logged but non-blocking
}

export function runStructuralAssertions(
  parsedPlan: ParsedPlan,
  template: FullTemplate,
  weeksNeeded: number,
  raceDayNumber: number
): StructuralResult {
  return {
    blocking: [
      ...assertWeekStructure(parsedPlan, weeksNeeded),
      ...assertRaceDay(parsedPlan, weeksNeeded, raceDayNumber),
      ...assertSessionsHaveMainSet(parsedPlan),
    ],
    // B2B-hard is advisory until templates carry `hard_day_pattern` metadata —
    // current heuristic over-flags methodologies (e.g. Pfitz tempo→long_run on Tue/Wed)
    // that legitimately schedule consecutive hard days.
    advisory: assertNoBackToBackHard(parsedPlan, template),
  }
}
