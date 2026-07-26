import { describe, it, expect } from 'vitest'
import { computeComplianceScore, interpretAccuracyScore } from '../scoring'

type Lap = { intensity_type: string | null; compliance_score: number | null }

const lap = (intensity_type: string | null, compliance_score: number | null): Lap =>
  ({ intensity_type, compliance_score })

describe('computeComplianceScore — free runs have no compliance data', () => {
  it('treats an all-zero lap set as no data, not as a zero score', () => {
    // Regression (planned_workout 11656, "Easy 4 mi"): the athlete ran freely with no
    // structured workout on the watch, so Garmin returned
    // directWorkoutComplianceScore = 0 on all 11 auto-split laps. Stored at face value
    // this rendered as a red "Pace Compliance: 0%" on six of ten completed workouts.
    const laps = Array.from({ length: 11 }, () => lap('INTERVAL', 0))
    const result = computeComplianceScore(laps)

    expect(result.hasData).toBe(false)
    expect(result.activeLapAvg).toBeNull()
    // hasData false → buildScoringResult stores accuracy_score null → the card hides it.
    expect(interpretAccuracyScore(null, 'easy_run')).toBeNull()
  })

  it('still scores a structured session where only some laps are zero', () => {
    // A genuinely poor session scores above zero somewhere — that is real data and
    // must survive.
    const laps = [
      lap('WARMUP', 0),
      lap('ACTIVE', 40),
      lap('ACTIVE', 0),
      lap('COOLDOWN', 0),
    ]
    const result = computeComplianceScore(laps)

    expect(result.hasData).toBe(true)
    expect(result.lapCount).toBe(4)
    expect(result.activeLapAvg).toBe(20) // (40 + 0) / 2
  })

  it('reports no data when no lap carries a score at all', () => {
    expect(computeComplianceScore([lap('ACTIVE', null)]).hasData).toBe(false)
    expect(computeComplianceScore([]).hasData).toBe(false)
  })

  it('keeps the existing role weighting for a synced workout', () => {
    // ACTIVE/INTERVAL weight 1.0, WARMUP/COOLDOWN/RECOVERY 0.3, other 0.5.
    const laps = [
      lap('WARMUP', 50),
      lap('ACTIVE', 90),
      lap('COOLDOWN', 50),
    ]
    const result = computeComplianceScore(laps)

    const expected = Math.round((50 * 0.3 + 90 * 1.0 + 50 * 0.3) / (0.3 + 1.0 + 0.3))
    expect(result.hasData).toBe(true)
    expect(result.score).toBe(expected)
    expect(result.activeLapAvg).toBe(90)
  })
})
