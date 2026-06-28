import {
  ParsedRunningPlan,
  ImportedWeek,
  ImportedWorkout,
} from '@/lib/plans/import/schemas'
import { normalizeIntensity, RunIntensity } from '@/lib/plans/import/intensity'

/**
 * Deterministic cleanup applied to the LLM's parsed plan before it is shown for
 * review / persisted. The LLM extracts; we own the invariants:
 *   - weeks ordered ascending and re-indexed 1..N (no gaps, no dupes)
 *   - intensity strings mapped onto canonical tokens (or nulled + warned)
 *   - workouts within a week sorted by day_of_week
 *   - derived metadata (total_weeks) computed, not trusted from the LLM
 *
 * Unit conversion is the LLM's job per the prompt; we do not re-convert here
 * (we can't know the original unit post-hoc). We only validate/sanitize shape.
 */
export interface NormalizeResult {
  plan: ParsedRunningPlan
  totalWeeks: number
  addedWarnings: string[]
}

export function normalizeParsedPlan(input: ParsedRunningPlan): NormalizeResult {
  const addedWarnings: string[] = []

  // 1. Sort weeks ascending by their stated week_index, then re-index 1..N so
  //    downstream code (apply/fit) can rely on a dense ascending sequence. The
  //    LLM is told to already reverse "weeks to goal"; this is the safety net.
  const sortedWeeks = [...input.weeks].sort((a, b) => a.week_index - b.week_index)

  const weeks: ImportedWeek[] = sortedWeeks.map((week, i) => {
    const newIndex = i + 1
    const workouts = normalizeWeekWorkouts(week.workouts, newIndex, addedWarnings)
    return { ...week, week_index: newIndex, workouts }
  })

  // 2. Re-anchor detected_race_week onto the re-indexed sequence. If the LLM
  //    flagged a race week, find which (now re-indexed) week holds a 'race'
  //    workout and trust that; otherwise keep the clamped original.
  const detectedRaceWeek = resolveRaceWeek(input.detected_race_week, weeks)

  const plan: ParsedRunningPlan = {
    ...input,
    weeks,
    detected_race_week: detectedRaceWeek,
    parse_warnings: [...(input.parse_warnings ?? []), ...addedWarnings],
  }

  return { plan, totalWeeks: weeks.length, addedWarnings }
}

function normalizeWeekWorkouts(
  workouts: ImportedWorkout[],
  weekIndex: number,
  addedWarnings: string[],
): ImportedWorkout[] {
  // Sort by day so the calendar/preview render in week order.
  const sorted = [...workouts].sort((a, b) => a.day_of_week - b.day_of_week)

  return sorted.map(w => {
    let intensity: RunIntensity | null | undefined = w.intensity ?? null

    // If the LLM gave a non-canonical / free-text intensity, try to map it.
    if (intensity != null && !isCanonical(intensity)) {
      const mapped = normalizeIntensity(intensity as unknown as string)
      if (mapped) {
        intensity = mapped
      } else {
        addedWarnings.push(
          `Week ${weekIndex}, day ${w.day_of_week}: couldn't classify effort "${intensity}" — left unset.`,
        )
        intensity = null
      }
    }

    // Running days that carry neither distance, duration, nor a structured
    // workout are suspicious — surface for the human reviewer.
    const isRun = w.type !== 'rest' && w.type !== 'cross_training'
    const hasLoad =
      (w.distance_meters ?? 0) > 0 ||
      (w.duration_seconds ?? 0) > 0 ||
      w.structured_workout != null
    if (isRun && !hasLoad) {
      addedWarnings.push(
        `Week ${weekIndex}, day ${w.day_of_week}: ${w.type} has no distance or duration — please verify.`,
      )
    }

    return { ...w, intensity }
  })
}

function resolveRaceWeek(
  detected: number | null | undefined,
  weeks: ImportedWeek[],
): number | null {
  const weekWithRace = weeks.find(wk => wk.workouts.some(w => w.type === 'race'))
  if (weekWithRace) return weekWithRace.week_index
  if (detected == null) return null
  // Clamp a stated race week into range.
  return Math.min(Math.max(1, detected), weeks.length)
}

const CANONICAL = new Set<string>([
  'recovery',
  'easy',
  'long',
  'marathon_pace',
  'threshold',
  'vo2max',
  'rep',
  'strides',
  'race',
])

function isCanonical(v: string): boolean {
  return CANONICAL.has(v)
}
