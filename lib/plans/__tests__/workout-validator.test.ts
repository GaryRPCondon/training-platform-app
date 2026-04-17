import { describe, it, expect } from 'vitest'
import { validateWorkoutDistances, formatValidationWarnings } from '../workout-validator'
import type { ParsedPlan, ParsedWorkout } from '../response-parser'
import type { PaceTarget } from '@/lib/templates/types'

// Marathon-style ranges (similar to what was hardcoded before)
const MARATHON_RANGES: Record<string, { min: number; max: number }> = {
  intervals: { min: 3000, max: 25000 },
  tempo: { min: 5000, max: 35000 },
  easy_run: { min: 3000, max: 25000 },
  long_run: { min: 10000, max: 50000 },
  recovery: { min: 3000, max: 12000 },
  cross_training: { min: 0, max: 0 },
  rest: { min: 0, max: 0 },
  race: { min: 5000, max: 100000 },
}

// C25K beginner ranges
const C25K_RANGES: Record<string, { min: number; max: number }> = {
  easy_run: { min: 800, max: 5000 },
  long_run: { min: 1500, max: 6000 },
  recovery: { min: 500, max: 3000 },
  race: { min: 4000, max: 6000 },
  rest: { min: 0, max: 0 },
  cross_training: { min: 0, max: 0 },
}

function makePlan(workouts: ParsedWorkout[]): ParsedPlan {
  return {
    weeks: [{
      week_number: 1,
      phase: 'base',
      weekly_total_km: 50,
      workouts,
    }],
  }
}

function makeWorkout(
  type: string,
  distance_meters: number | null,
  overrides: Partial<ParsedWorkout> = {}
): ParsedWorkout {
  return {
    day: 1,
    workout_index: 'W1:D1',
    type,
    description: `${type} workout`,
    distance_meters,
    intensity: 'easy',
    pace_guidance: null,
    notes: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// validateWorkoutDistances
// ---------------------------------------------------------------------------

describe('validateWorkoutDistances', () => {
  it('returns no warnings for workouts within valid ranges', () => {
    const plan = makePlan([
      makeWorkout('easy_run', 10000),     // 10km — valid (3-25km)
      makeWorkout('long_run', 30000),     // 30km — valid (10-50km)
      makeWorkout('intervals', 8000),     // 8km — valid (3-25km)
      makeWorkout('tempo', 15000),        // 15km — valid (5-35km)
      makeWorkout('recovery', 6000),      // 6km — valid (3-12km)
    ])
    expect(validateWorkoutDistances(plan, MARATHON_RANGES)).toHaveLength(0)
  })

  it('warns when intervals workout is below minimum (2km < 3km)', () => {
    const plan = makePlan([makeWorkout('intervals', 2000, { workout_index: 'W1:D3' })])
    const warnings = validateWorkoutDistances(plan, MARATHON_RANGES)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].workoutType).toBe('intervals')
    expect(warnings[0].actualDistance).toBe(2000)
  })

  it('warns when long_run exceeds maximum (55km > 50km)', () => {
    // 55km is 10% over 50km max, so it should trigger (tolerance allows up to 55km)
    const plan = makePlan([makeWorkout('long_run', 56000, { workout_index: 'W1:D7' })])
    const warnings = validateWorkoutDistances(plan, MARATHON_RANGES)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].workoutType).toBe('long_run')
  })

  it('skips rest day (no distance validation)', () => {
    const plan = makePlan([makeWorkout('rest', 0)])
    expect(validateWorkoutDistances(plan, MARATHON_RANGES)).toHaveLength(0)
  })

  it('skips cross_training (no distance validation)', () => {
    const plan = makePlan([makeWorkout('cross_training', 10000)])
    expect(validateWorkoutDistances(plan, MARATHON_RANGES)).toHaveLength(0)
  })

  it('skips workout with null distance', () => {
    const plan = makePlan([makeWorkout('easy_run', null)])
    expect(validateWorkoutDistances(plan, MARATHON_RANGES)).toHaveLength(0)
  })

  it('skips workout with zero distance', () => {
    const plan = makePlan([makeWorkout('easy_run', 0)])
    expect(validateWorkoutDistances(plan, MARATHON_RANGES)).toHaveLength(0)
  })

  it('skips unknown workout types', () => {
    const plan = makePlan([makeWorkout('unknown_type', 500)])
    expect(validateWorkoutDistances(plan, MARATHON_RANGES)).toHaveLength(0)
  })

  it('collects multiple warnings across weeks', () => {
    const plan: ParsedPlan = {
      weeks: [
        {
          week_number: 1,
          phase: 'base',
          weekly_total_km: 60,
          workouts: [
            makeWorkout('intervals', 1000, { workout_index: 'W1:D2' }),  // too short
            makeWorkout('long_run', 60000, { workout_index: 'W1:D7' }),  // too long
          ],
        },
      ],
    }
    expect(validateWorkoutDistances(plan, MARATHON_RANGES)).toHaveLength(2)
  })

  it('warning includes correct workoutIndex, weekNumber, dayNumber', () => {
    const plan = makePlan([makeWorkout('recovery', 500, { workout_index: 'W1:D4', day: 4 })])
    const warnings = validateWorkoutDistances(plan, MARATHON_RANGES)
    expect(warnings[0].workoutIndex).toBe('W1:D4')
    expect(warnings[0].weekNumber).toBe(1)
    expect(warnings[0].dayNumber).toBe(4)
  })

  it('race type is valid within range (10km race)', () => {
    const plan = makePlan([makeWorkout('race', 10000, { workout_index: 'W1:D7' })])
    expect(validateWorkoutDistances(plan, MARATHON_RANGES)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Total session distance (structured_workout with warmup/cooldown/recovery)
// ---------------------------------------------------------------------------

describe('validateWorkoutDistances — total session distance', () => {
  // Mimics what enrichParsedWorkouts produces for an interval workout
  function intervalSW(mainSet: unknown[]) {
    return {
      warmup: { duration_minutes: 15, intensity: 'easy' },
      main_set: mainSet,
      cooldown: { duration_minutes: 10, intensity: 'easy' },
      pace_guidance: null,
      notes: null,
    }
  }

  it('passes 5x400m intervals (active 2km but total ~6km) within 3-12km range', () => {
    // Reproduces the user-reported bug: "5 x 400m at mile pace, 400m recovery"
    // has main-set 2km but with warmup/cooldown/recovery is ~8km total.
    const plan = makePlan([
      makeWorkout('intervals', 2000, {
        structured_workout: intervalSW([
          {
            repeat: 5,
            intervals: [
              { distance_meters: 400, intensity: 'interval' },
              { distance_meters: 400, intensity: 'recovery' },
            ],
          },
        ]),
      }),
    ])
    expect(validateWorkoutDistances(plan, MARATHON_RANGES)).toHaveLength(0)
  })

  it('warns when even total session distance is below the range', () => {
    // 3x200m, no recovery, with tiny warmup/cooldown — total ~1km, below 3km min
    const plan = makePlan([
      makeWorkout('intervals', 600, {
        structured_workout: {
          warmup: { duration_minutes: 1, intensity: 'easy' },
          main_set: [
            { repeat: 3, intervals: [{ distance_meters: 200, intensity: 'interval' }] },
          ],
          cooldown: { duration_minutes: 1, intensity: 'easy' },
        },
      }),
    ])
    const warnings = validateWorkoutDistances(plan, MARATHON_RANGES)
    expect(warnings).toHaveLength(1)
    // actualDistance should be the *total* (~932m), not the 600m main-set
    expect(warnings[0].actualDistance).toBeGreaterThan(600)
    expect(warnings[0].actualDistance).toBeLessThan(1500)
  })

  it('still falls back to distance_meters when no structured_workout is present', () => {
    // No structured_workout → validator uses workout.distance_meters directly.
    // Preserves behaviour for easy_run/long_run/recovery workouts.
    const plan = makePlan([makeWorkout('easy_run', 10000)])
    expect(validateWorkoutDistances(plan, MARATHON_RANGES)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// ±10% tolerance
// ---------------------------------------------------------------------------

describe('±10% tolerance', () => {
  it('allows distance 10% below minimum without warning', () => {
    // easy_run min is 3000, 10% tolerance = 2700
    const plan = makePlan([makeWorkout('easy_run', 2700)])
    expect(validateWorkoutDistances(plan, MARATHON_RANGES)).toHaveLength(0)
  })

  it('warns when distance exceeds 10% below minimum', () => {
    // easy_run min is 3000, 10% tolerance = 2700, so 2699 should warn
    const plan = makePlan([makeWorkout('easy_run', 2699)])
    expect(validateWorkoutDistances(plan, MARATHON_RANGES)).toHaveLength(1)
  })

  it('allows distance 10% above maximum without warning', () => {
    // easy_run max is 25000, 10% tolerance = 27500
    const plan = makePlan([makeWorkout('easy_run', 27500)])
    expect(validateWorkoutDistances(plan, MARATHON_RANGES)).toHaveLength(0)
  })

  it('warns when distance exceeds 10% above maximum', () => {
    // easy_run max is 25000, 10% tolerance = 27500, so 27501 should warn
    const plan = makePlan([makeWorkout('easy_run', 27501)])
    expect(validateWorkoutDistances(plan, MARATHON_RANGES)).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Template-specific ranges (C25K)
// ---------------------------------------------------------------------------

describe('template-specific ranges', () => {
  it('accepts 1.2km easy_run with C25K ranges', () => {
    const plan = makePlan([makeWorkout('easy_run', 1200)])
    expect(validateWorkoutDistances(plan, C25K_RANGES)).toHaveLength(0)
  })

  it('rejects 1.2km easy_run with marathon ranges', () => {
    const plan = makePlan([makeWorkout('easy_run', 1200)])
    expect(validateWorkoutDistances(plan, MARATHON_RANGES)).toHaveLength(1)
  })

  it('accepts 2km long_run with C25K ranges', () => {
    const plan = makePlan([makeWorkout('long_run', 2000)])
    expect(validateWorkoutDistances(plan, C25K_RANGES)).toHaveLength(0)
  })

  it('rejects 2km long_run with marathon ranges', () => {
    const plan = makePlan([makeWorkout('long_run', 2000)])
    expect(validateWorkoutDistances(plan, MARATHON_RANGES)).toHaveLength(1)
  })

  it('accepts 5km race with C25K ranges', () => {
    const plan = makePlan([makeWorkout('race', 5000)])
    expect(validateWorkoutDistances(plan, C25K_RANGES)).toHaveLength(0)
  })

  it('rejects 50km long_run with C25K ranges', () => {
    const plan = makePlan([makeWorkout('long_run', 50000)])
    expect(validateWorkoutDistances(plan, C25K_RANGES)).toHaveLength(1)
  })

  it('skips workout type not in template ranges', () => {
    // C25K ranges don't have 'intervals'
    const plan = makePlan([makeWorkout('intervals', 500)])
    expect(validateWorkoutDistances(plan, C25K_RANGES)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Time-prescribed intensities (per-template prescription:time)
// ---------------------------------------------------------------------------

describe('time-prescribed intensities', () => {
  const HAL_NOVICE_RANGES: Record<string, { min: number; max: number }> = {
    easy_run: { min: 1500, max: 6000 },
    long_run: { min: 2400, max: 8000 },
    rest: { min: 0, max: 0 },
  }

  const HAL_NOVICE_PACE_TARGETS: Record<string, PaceTarget> = {
    easy: { reference_pace: 'easy', description: 'Comfortable conversational pace' },
    walk: { reference_pace: 'walk', description: 'Brisk walking pace', prescription: 'time' },
  }

  it('skips workout whose intensity is declared time-prescribed (walk at huge inferred distance)', () => {
    // A 60-minute walk would infer ~9-12km via easy pace fallback and trip easy_run.max=6000.
    const plan = makePlan([
      makeWorkout('easy_run', 10000, { intensity: 'walk', workout_index: 'W1:D7' }),
    ])
    const warnings = validateWorkoutDistances(plan, HAL_NOVICE_RANGES, null, HAL_NOVICE_PACE_TARGETS)
    expect(warnings).toHaveLength(0)
  })

  it('still validates workouts with distance-prescribed intensities', () => {
    // Same template — easy has no prescription, so standard validation applies.
    const plan = makePlan([
      makeWorkout('easy_run', 10000, { intensity: 'easy', workout_index: 'W1:D2' }),
    ])
    const warnings = validateWorkoutDistances(plan, HAL_NOVICE_RANGES, null, HAL_NOVICE_PACE_TARGETS)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].workoutType).toBe('easy_run')
  })

  it('is a no-op when pace_targets is not provided', () => {
    // Preserves legacy call sites — validator works without pace_targets.
    const plan = makePlan([
      makeWorkout('easy_run', 10000, { intensity: 'walk' }),
    ])
    const warnings = validateWorkoutDistances(plan, HAL_NOVICE_RANGES)
    expect(warnings).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// formatValidationWarnings
// ---------------------------------------------------------------------------

describe('formatValidationWarnings', () => {
  it('returns empty string for no warnings', () => {
    expect(formatValidationWarnings([])).toBe('')
  })

  it('formats a single warning with workout details', () => {
    const plan = makePlan([makeWorkout('intervals', 2000, { description: 'Speed session' })])
    const warnings = validateWorkoutDistances(plan, MARATHON_RANGES)
    const output = formatValidationWarnings(warnings)
    expect(output).toContain('W1:D1')
    expect(output).toContain('Speed session')
    expect(output).toContain('2.0km')
    expect(output).toContain('intervals')
  })

  it('includes "Potential LLM Hallucinations Detected" header', () => {
    const plan = makePlan([makeWorkout('long_run', 60000)])
    const warnings = validateWorkoutDistances(plan, MARATHON_RANGES)
    expect(formatValidationWarnings(warnings)).toContain('Potential LLM Hallucinations Detected')
  })

  it('includes regeneration suggestion', () => {
    const plan = makePlan([makeWorkout('long_run', 60000)])
    const warnings = validateWorkoutDistances(plan, MARATHON_RANGES)
    expect(formatValidationWarnings(warnings)).toContain('regenerating')
  })

  it('lists all warnings when multiple exist', () => {
    const plan: ParsedPlan = {
      weeks: [{
        week_number: 1,
        phase: 'base',
        weekly_total_km: 60,
        workouts: [
          makeWorkout('intervals', 500, { workout_index: 'W1:D2', day: 2 }),
          makeWorkout('long_run', 60000, { workout_index: 'W1:D7', day: 7 }),
        ],
      }],
    }
    const warnings = validateWorkoutDistances(plan, MARATHON_RANGES)
    const output = formatValidationWarnings(warnings)
    expect(output).toContain('W1:D2')
    expect(output).toContain('W1:D7')
  })
})
