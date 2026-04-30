import { describe, it, expect } from 'vitest'
import { parseLLMResponse, calculateWorkoutDate, inferPhase } from '../response-parser'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWorkout(overrides = {}) {
  return {
    day: 1,
    workout_index: 'W1:D1',
    type: 'easy_run',
    description: 'Easy run',
    distance_meters: 8000,
    intensity: 'easy',
    pace_guidance: '5:30-6:00/km',
    notes: null,
    ...overrides,
  }
}

function makeWeek(weekNumber: number, workouts = [makeWorkout()]) {
  return {
    week_number: weekNumber,
    phase: 'base',
    weekly_total_km: 40,
    workouts,
  }
}

function makePlanJson(weeks = [makeWeek(1)], extras = {}) {
  return JSON.stringify({ weeks, ...extras })
}

// ---------------------------------------------------------------------------
// parseLLMResponse
// ---------------------------------------------------------------------------

describe('parseLLMResponse', () => {
  it('parses valid JSON with weeks and workouts', () => {
    const result = parseLLMResponse(makePlanJson())
    expect(result.weeks).toHaveLength(1)
    expect(result.weeks[0].week_number).toBe(1)
    expect(result.weeks[0].workouts[0].type).toBe('easy_run')
  })

  it('strips ```json code block wrapper', () => {
    const json = makePlanJson()
    const wrapped = '```json\n' + json + '\n```'
    const result = parseLLMResponse(wrapped)
    expect(result.weeks).toHaveLength(1)
  })

  it('strips plain ``` code block wrapper', () => {
    const json = makePlanJson()
    const wrapped = '```\n' + json + '\n```'
    const result = parseLLMResponse(wrapped)
    expect(result.weeks).toHaveLength(1)
  })

  it('throws for malformed JSON', () => {
    expect(() => parseLLMResponse('not valid json')).toThrow('Invalid JSON response')
  })

  it('throws when "weeks" array is missing', () => {
    expect(() => parseLLMResponse(JSON.stringify({ data: [] }))).toThrow('Response missing "weeks" array')
  })

  it('throws when week_number is missing', () => {
    const bad = JSON.stringify({ weeks: [{ workouts: [] }] })
    expect(() => parseLLMResponse(bad)).toThrow('Week missing week_number')
  })

  it('throws when workouts array is missing', () => {
    const bad = JSON.stringify({ weeks: [{ week_number: 1 }] })
    expect(() => parseLLMResponse(bad)).toThrow('Week 1 missing workouts array')
  })

  it('throws for invalid day number 0', () => {
    const bad = makePlanJson([makeWeek(1, [makeWorkout({ day: 0 })])])
    expect(() => parseLLMResponse(bad)).toThrow('Invalid day')
  })

  it('throws for invalid day number 8', () => {
    const bad = makePlanJson([makeWeek(1, [makeWorkout({ day: 8 })])])
    expect(() => parseLLMResponse(bad)).toThrow('Invalid day')
  })

  it('throws for missing workout_index', () => {
    const bad = makePlanJson([makeWeek(1, [makeWorkout({ workout_index: '' })])])
    expect(() => parseLLMResponse(bad)).toThrow('Missing workout_index')
  })

  it('throws for missing workout type', () => {
    const bad = makePlanJson([makeWeek(1, [makeWorkout({ type: '' })])])
    expect(() => parseLLMResponse(bad)).toThrow('Missing or invalid type')
  })

  it('generates fallback description when missing (does not throw)', () => {
    const workout = makeWorkout({ description: '', distance_meters: 8000 })
    const plan = makePlanJson([makeWeek(1, [workout])])
    const result = parseLLMResponse(plan)
    expect(result.weeks[0].workouts[0].description).toBe('Easy run')
  })

  it('generates type-label fallback when description missing and no distance', () => {
    const workout = makeWorkout({ description: '', distance_meters: null })
    const plan = makePlanJson([makeWeek(1, [workout])])
    const result = parseLLMResponse(plan)
    expect(result.weeks[0].workouts[0].description).toBe('Easy run')
  })

  it('does not throw when interval workout is missing structured_workout.main_set', () => {
    const workout = makeWorkout({ type: 'intervals', workout_index: 'W1:D3', structured_workout: null })
    const plan = makePlanJson([makeWeek(1, [workout])])
    // Should warn but not throw
    expect(() => parseLLMResponse(plan)).not.toThrow()
  })

  it('parses pre_week_workouts when present', () => {
    const preWeek = [{
      type: 'easy_run',
      distance_km: 5,
      intensity: 'easy',
      description: 'Shakeout run',
      pace_guidance: '6:00/km',
      notes: null,
    }]
    const json = JSON.stringify({ weeks: [makeWeek(1)], pre_week_workouts: preWeek })
    const result = parseLLMResponse(json)
    expect(result.preWeekWorkouts).toHaveLength(1)
    expect(result.preWeekWorkouts![0].type).toBe('easy_run')
    expect(result.preWeekWorkouts![0].distance_km).toBe(5)
  })

  it('converts distance_meters to distance_km when distance_km is absent', () => {
    const preWeek = [{
      type: 'easy_run',
      distance_meters: 8000,
      intensity: 'easy',
      description: 'Shakeout run',
    }]
    const json = JSON.stringify({ weeks: [makeWeek(1)], pre_week_workouts: preWeek })
    const result = parseLLMResponse(json)
    expect(result.preWeekWorkouts![0].distance_km).toBe(8)
  })

  it('throws for pre_week_workout missing type', () => {
    const preWeek = [{ intensity: 'easy', description: 'Run' }]
    const json = JSON.stringify({ weeks: [makeWeek(1)], pre_week_workouts: preWeek })
    expect(() => parseLLMResponse(json)).toThrow('Pre-week workout 1 missing or invalid type')
  })

  it('returns undefined preWeekWorkouts when not present', () => {
    const result = parseLLMResponse(makePlanJson())
    expect(result.preWeekWorkouts).toBeUndefined()
  })

  it('parses multiple weeks correctly', () => {
    const weeks = [makeWeek(1), makeWeek(2), makeWeek(3)]
    const result = parseLLMResponse(makePlanJson(weeks))
    expect(result.weeks).toHaveLength(3)
    expect(result.weeks[2].week_number).toBe(3)
  })

  it('normalizes distance_meters: 0 to null', () => {
    const workout = makeWorkout({ distance_meters: 0, type: 'tempo', description: 'LT Tempo 20 min' })
    const plan = makePlanJson([makeWeek(1, [workout])])
    const result = parseLLMResponse(plan)
    expect(result.weeks[0].workouts[0].distance_meters).toBeNull()
  })

  it('passes through duration_seconds from LLM JSON', () => {
    const workout = makeWorkout({ distance_meters: null, duration_seconds: 1200, type: 'tempo', description: 'LT Tempo 20 min' })
    const plan = makePlanJson([makeWeek(1, [workout])])
    const result = parseLLMResponse(plan)
    expect(result.weeks[0].workouts[0].duration_seconds).toBe(1200)
  })

  it('defaults duration_seconds to null when not provided', () => {
    const result = parseLLMResponse(makePlanJson())
    expect(result.weeks[0].workouts[0].duration_seconds).toBeNull()
  })

  it('generates type-label fallback when description missing and only duration present', () => {
    const workout = makeWorkout({ description: '', distance_meters: null, duration_seconds: 1200, type: 'tempo' })
    const plan = makePlanJson([makeWeek(1, [workout])])
    const result = parseLLMResponse(plan)
    expect(result.weeks[0].workouts[0].description).toBe('Tempo run')
  })
})

// ---------------------------------------------------------------------------
// calculateWorkoutDate
// ---------------------------------------------------------------------------

describe('calculateWorkoutDate', () => {
  it('day 1 on week start returns week start date', () => {
    expect(calculateWorkoutDate('2026-03-23', 1)).toBe('2026-03-23')
  })

  it('day 2 returns next day', () => {
    expect(calculateWorkoutDate('2026-03-23', 2)).toBe('2026-03-24')
  })

  it('day 7 returns Sunday (last day of week)', () => {
    expect(calculateWorkoutDate('2026-03-23', 7)).toBe('2026-03-29')
  })

  it('handles month boundary (Jan 30 + 3 days → Feb 2)', () => {
    expect(calculateWorkoutDate('2026-01-30', 4)).toBe('2026-02-02')
  })

  it('accepts a Date object as input', () => {
    const date = new Date('2026-03-23T00:00:00Z')
    expect(calculateWorkoutDate(date, 1)).toBe('2026-03-23')
  })
})

// ---------------------------------------------------------------------------
// inferPhase
// ---------------------------------------------------------------------------

describe('inferPhase', () => {
  it('week 1 of 20 (5%) → base', () => {
    expect(inferPhase(1, 20)).toBe('base')
  })

  it('week 5 of 20 (25%) → base (boundary)', () => {
    expect(inferPhase(5, 20)).toBe('base')
  })

  it('week 6 of 20 (30%) → build', () => {
    expect(inferPhase(6, 20)).toBe('build')
  })

  it('week 14 of 20 (70%) → build (boundary)', () => {
    expect(inferPhase(14, 20)).toBe('build')
  })

  it('week 15 of 20 (75%) → peak', () => {
    expect(inferPhase(15, 20)).toBe('peak')
  })

  it('week 17 of 20 (85%) → peak (85% is at peak/taper boundary, peak wins with <=)', () => {
    // progress = 17/20 = 0.85 → satisfies `progress <= 0.85` → 'peak', not 'taper'
    expect(inferPhase(17, 20)).toBe('peak')
  })

  it('week 18 of 20 (90%) → taper', () => {
    expect(inferPhase(18, 20)).toBe('taper')
  })

  it('week 20 of 20 (100%) → taper', () => {
    expect(inferPhase(20, 20)).toBe('taper')
  })
})
