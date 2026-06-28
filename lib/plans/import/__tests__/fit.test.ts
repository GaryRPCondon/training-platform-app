import { describe, it, expect } from 'vitest'
import { computeWeeksAvailable, fitWeeksToWindow } from '../fit'
import type { ImportedWeek } from '../schemas'

// Build a week with a given volume (single easy run carries the volume) and
// optional phase / race flag.
function wk(
  weekIndex: number,
  volumeMeters: number,
  opts?: { phase?: 'base' | 'build' | 'peak' | 'taper'; race?: boolean },
): ImportedWeek {
  const workouts: ImportedWeek['workouts'] = [
    { day_of_week: 3, type: 'easy_run', description: 'Easy', distance_meters: volumeMeters, intensity: 'easy' },
  ]
  if (opts?.race) {
    workouts.push({ day_of_week: 7, type: 'race', description: 'Race', distance_meters: 42195, intensity: 'race' })
  }
  return { week_index: weekIndex, phase: opts?.phase ?? null, workouts }
}

describe('computeWeeksAvailable', () => {
  it('counts inclusive whole weeks start->race', () => {
    // 2026-01-05 -> 2026-04-19 is 104 calendar days -> floor(104/7)+1 = 15
    expect(computeWeeksAvailable('2026-01-05', '2026-04-19')).toBe(15)
    // exactly 105 days (15 weeks) after start -> 16
    expect(computeWeeksAvailable('2026-01-05', '2026-04-20')).toBe(16)
    expect(computeWeeksAvailable('2026-01-05', '2026-01-05')).toBe(1)
  })
})

describe('fitWeeksToWindow', () => {
  const eighteen: ImportedWeek[] = Array.from({ length: 18 }, (_, i) => {
    // Make weeks 4, 8, 12 low-volume "recovery" weeks; last week is race.
    const isRecovery = [4, 8, 12].includes(i + 1)
    const isRace = i === 17
    return wk(i + 1, isRecovery ? 30000 : 80000, isRace ? { phase: 'taper', race: true } : undefined)
  })

  it('returns exact unchanged (re-indexed) when window matches', () => {
    const r = fitWeeksToWindow(eighteen, 18)
    expect(r.fitMode).toBe('exact')
    expect(r.weeks).toHaveLength(18)
    expect(r.weeks.map(w => w.week_index)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1))
  })

  it('compresses by dropping lowest-volume weeks first, protecting the tail/race', () => {
    const r = fitWeeksToWindow(eighteen, 16, null)
    expect(r.fitMode).toBe('compress')
    expect(r.weeks).toHaveLength(16)
    // The two dropped should be among the recovery weeks (4, 8, 12), never the race week.
    expect(r.droppedWeekIndices).toHaveLength(2)
    expect(r.droppedWeekIndices.every(i => [4, 8, 12].includes(i))).toBe(true)
    expect(r.droppedWeekIndices).not.toContain(18)
    // Race workout survives in the final week.
    expect(r.weeks[r.weeks.length - 1].workouts.some(w => w.type === 'race')).toBe(true)
    // Re-indexed densely.
    expect(r.weeks.map(w => w.week_index)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1))
  })

  it('never drops the protected tail even when many weeks are removed', () => {
    const r = fitWeeksToWindow(eighteen, 14, null)
    expect(r.weeks).toHaveLength(14)
    // Last two original weeks (17 taper, 18 race) are protected.
    expect(r.droppedWeekIndices).not.toContain(17)
    expect(r.droppedWeekIndices).not.toContain(18)
  })

  it('stretches by duplicating lowest-volume weeks, protecting tail/race', () => {
    const r = fitWeeksToWindow(eighteen, 20, null)
    expect(r.fitMode).toBe('stretch')
    expect(r.weeks).toHaveLength(20)
    expect(r.duplicatedWeekIndices).toHaveLength(2)
    // Duplicates drawn from recovery weeks (lowest volume).
    expect(r.duplicatedWeekIndices.every(i => [4, 8, 12].includes(i))).toBe(true)
    // Exactly one race workout overall (race week not duplicated).
    const raceWeeks = r.weeks.filter(w => w.workouts.some(x => x.type === 'race'))
    expect(raceWeeks).toHaveLength(1)
  })

  it('handles empty input', () => {
    const r = fitWeeksToWindow([], 5)
    expect(r.fitMode).toBe('exact')
    expect(r.weeks).toEqual([])
  })
})
