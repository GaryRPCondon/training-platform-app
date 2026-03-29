import { describe, it, expect } from 'vitest'
import { validateWorkoutDistances, formatValidationWarnings } from '../workout-validator'
import type { ParsedPlan } from '../response-parser'

function makePlan(workouts: any[]): ParsedPlan {
  return {
    weeks: [{
      week_number: 1,
      phase: 'base',
      weekly_total_km: 50,
      workouts,
    }],
  }
}

function makeWorkout(type: string, distance_meters: number | null, overrides = {}) {
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
    expect(validateWorkoutDistances(plan)).toHaveLength(0)
  })

  it('warns when intervals workout is below minimum (2km < 3km)', () => {
    const plan = makePlan([makeWorkout('intervals', 2000, { workout_index: 'W1:D3' })])
    const warnings = validateWorkoutDistances(plan)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].workoutType).toBe('intervals')
    expect(warnings[0].actualDistance).toBe(2000)
  })

  it('warns when long_run exceeds maximum (55km > 50km)', () => {
    const plan = makePlan([makeWorkout('long_run', 55000, { workout_index: 'W1:D7' })])
    const warnings = validateWorkoutDistances(plan)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].workoutType).toBe('long_run')
  })

  it('skips rest day (no distance validation)', () => {
    const plan = makePlan([makeWorkout('rest', 0)])
    expect(validateWorkoutDistances(plan)).toHaveLength(0)
  })

  it('skips cross_training (no distance validation)', () => {
    const plan = makePlan([makeWorkout('cross_training', 10000)])
    expect(validateWorkoutDistances(plan)).toHaveLength(0)
  })

  it('skips workout with null distance', () => {
    const plan = makePlan([makeWorkout('easy_run', null)])
    expect(validateWorkoutDistances(plan)).toHaveLength(0)
  })

  it('skips workout with zero distance', () => {
    const plan = makePlan([makeWorkout('easy_run', 0)])
    expect(validateWorkoutDistances(plan)).toHaveLength(0)
  })

  it('skips unknown workout types', () => {
    const plan = makePlan([makeWorkout('unknown_type', 500)])
    expect(validateWorkoutDistances(plan)).toHaveLength(0)
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
    expect(validateWorkoutDistances(plan)).toHaveLength(2)
  })

  it('warning includes correct workoutIndex, weekNumber, dayNumber', () => {
    const plan = makePlan([makeWorkout('recovery', 500, { workout_index: 'W1:D4', day: 4 })])
    const warnings = validateWorkoutDistances(plan)
    expect(warnings[0].workoutIndex).toBe('W1:D4')
    expect(warnings[0].weekNumber).toBe(1)
    expect(warnings[0].dayNumber).toBe(4)
  })

  it('race type is valid within range (10km race)', () => {
    const plan = makePlan([makeWorkout('race', 10000, { workout_index: 'W1:D7' })])
    expect(validateWorkoutDistances(plan)).toHaveLength(0)
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
    const warnings = validateWorkoutDistances(plan)
    const output = formatValidationWarnings(warnings)
    expect(output).toContain('W1:D1')
    expect(output).toContain('Speed session')
    expect(output).toContain('2.0km')
    expect(output).toContain('intervals')
  })

  it('includes "Potential LLM Hallucinations Detected" header', () => {
    const plan = makePlan([makeWorkout('long_run', 55000)])
    const warnings = validateWorkoutDistances(plan)
    expect(formatValidationWarnings(warnings)).toContain('Potential LLM Hallucinations Detected')
  })

  it('includes regeneration suggestion', () => {
    const plan = makePlan([makeWorkout('long_run', 55000)])
    const warnings = validateWorkoutDistances(plan)
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
    const warnings = validateWorkoutDistances(plan)
    const output = formatValidationWarnings(warnings)
    expect(output).toContain('W1:D2')
    expect(output).toContain('W1:D7')
  })
})
