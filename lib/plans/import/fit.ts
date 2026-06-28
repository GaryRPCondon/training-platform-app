import { differenceInCalendarDays, parseISO } from 'date-fns'
import { ImportedWeek } from '@/lib/plans/import/schemas'
import { FitMode } from '@/lib/plans/import/schemas'

/**
 * Deterministic fit-to-window for imported plans.
 *
 * The imported definition is an ordered week sequence. When the athlete's
 * window (start → race) differs from the plan's length we compress or stretch
 * it WITHOUT rewriting any workouts — fidelity to the source book is the whole
 * point of importing it. Policy (confirmed with user):
 *   - protect the race week and the taper tail (last PROTECT_TAIL weeks)
 *   - compress by dropping the lowest-volume (recovery/down) non-protected
 *     weeks first
 *   - stretch by duplicating the lowest-volume non-protected (base) weeks
 *
 * LLM-assisted proportional adaptation is a separate, opt-in mode (Phase F).
 */

const PROTECT_TAIL = 2

export interface FitResult {
  weeks: ImportedWeek[]
  fitMode: FitMode
  droppedWeekIndices: number[]   // original week_index values dropped
  duplicatedWeekIndices: number[] // original week_index values duplicated
}

/** Whole weeks available in the window. Mirrors llm-prompts weeksNeeded. */
export function computeWeeksAvailable(startDate: string, raceDate: string): number {
  const days = differenceInCalendarDays(parseISO(raceDate), parseISO(startDate))
  return Math.max(1, Math.floor(days / 7) + 1)
}

function weekVolumeMeters(week: ImportedWeek): number {
  return week.workouts.reduce((sum, w) => sum + (w.distance_meters ?? 0), 0)
}

/**
 * Indices (0-based positions) that must never be dropped/displaced: the final
 * PROTECT_TAIL weeks (taper) plus any explicit race week and peak-phase weeks.
 */
function protectedPositions(weeks: ImportedWeek[], raceWeekIndex: number | null): Set<number> {
  const n = weeks.length
  const protectedSet = new Set<number>()
  for (let i = Math.max(0, n - PROTECT_TAIL); i < n; i++) protectedSet.add(i)
  weeks.forEach((w, i) => {
    if (w.phase === 'taper' || w.phase === 'peak') protectedSet.add(i)
    if (w.workouts.some(wk => wk.type === 'race')) protectedSet.add(i)
    if (raceWeekIndex != null && w.week_index === raceWeekIndex) protectedSet.add(i)
  })
  return protectedSet
}

function reindex(weeks: ImportedWeek[]): ImportedWeek[] {
  return weeks.map((w, i) => ({ ...w, week_index: i + 1 }))
}

export function fitWeeksToWindow(
  weeks: ImportedWeek[],
  weeksAvailable: number,
  raceWeekIndex: number | null = null,
): FitResult {
  const total = weeks.length

  if (weeksAvailable === total || total === 0) {
    return { weeks: reindex(weeks), fitMode: 'exact', droppedWeekIndices: [], duplicatedWeekIndices: [] }
  }

  if (weeksAvailable < total) {
    return compress(weeks, weeksAvailable, raceWeekIndex)
  }
  return stretch(weeks, weeksAvailable, raceWeekIndex)
}

function compress(weeks: ImportedWeek[], target: number, raceWeekIndex: number | null): FitResult {
  const protectedSet = protectedPositions(weeks, raceWeekIndex)
  const toRemove = weeks.length - target

  // Droppable positions, lowest-volume first (recovery/down weeks), then later
  // weeks before earlier ones as a tiebreak (keep early base intact).
  const droppable = weeks
    .map((w, i) => ({ i, vol: weekVolumeMeters(w) }))
    .filter(({ i }) => !protectedSet.has(i))
    .sort((a, b) => (a.vol - b.vol) || (b.i - a.i))

  const removePositions = new Set(droppable.slice(0, toRemove).map(d => d.i))
  const droppedWeekIndices = weeks.filter((_, i) => removePositions.has(i)).map(w => w.week_index)
  const kept = weeks.filter((_, i) => !removePositions.has(i))

  return { weeks: reindex(kept), fitMode: 'compress', droppedWeekIndices, duplicatedWeekIndices: [] }
}

function stretch(weeks: ImportedWeek[], target: number, raceWeekIndex: number | null): FitResult {
  const protectedSet = protectedPositions(weeks, raceWeekIndex)
  const toAdd = target - weeks.length

  // Duplicate lowest-volume non-protected (base/easy) weeks; cycle if we need
  // more duplicates than there are candidates.
  const candidates = weeks
    .map((w, i) => ({ i, vol: weekVolumeMeters(w) }))
    .filter(({ i }) => !protectedSet.has(i))
    .sort((a, b) => (a.vol - b.vol) || (a.i - b.i))

  // Fallback: if everything is protected, duplicate the earliest weeks.
  const pool = candidates.length > 0 ? candidates : weeks.map((_, i) => ({ i, vol: 0 }))

  // Count how many copies to insert after each source position.
  const copiesByPos = new Map<number, number>()
  for (let k = 0; k < toAdd; k++) {
    const pos = pool[k % pool.length].i
    copiesByPos.set(pos, (copiesByPos.get(pos) ?? 0) + 1)
  }

  const duplicatedWeekIndices: number[] = []
  const out: ImportedWeek[] = []
  weeks.forEach((w, i) => {
    out.push(w)
    const copies = copiesByPos.get(i) ?? 0
    for (let c = 0; c < copies; c++) {
      out.push(w)
      duplicatedWeekIndices.push(w.week_index)
    }
  })

  return { weeks: reindex(out), fitMode: 'stretch', droppedWeekIndices: [], duplicatedWeekIndices }
}
