import { describe, it, expect } from 'vitest'
import { buildMatchPlan } from '../workout-matcher'
import type { Activity, PlannedWorkout } from '@/types/database'

function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 1,
    activity_type: 'running',
    strava_data: null,
    start_time: '2026-05-26T08:00:00Z',
    distance_meters: 5000,
    duration_seconds: 1200,
    ...overrides,
  } as Activity
}

function makeWorkout(overrides: Partial<PlannedWorkout> = {}): PlannedWorkout {
  return {
    id: 100,
    scheduled_date: '2026-05-26',
    workout_type: 'tempo',
    distance_target_meters: 5000,
    duration_target_seconds: null,
    structured_workout: null,
    ...overrides,
  } as PlannedWorkout
}

describe('buildMatchPlan — multiple activities, one workout', () => {
  // Warm-up (2 km) + parkrun tempo (5 km) + cooldown (2 km), one planned tempo.
  const warmup = makeActivity({ id: 1, distance_meters: 2000, start_time: '2026-05-26T08:00:00Z' })
  const parkrun = makeActivity({ id: 2, distance_meters: 5000, start_time: '2026-05-26T08:30:00Z' })
  const cooldown = makeActivity({ id: 3, distance_meters: 2000, start_time: '2026-05-26T09:15:00Z' })
  const tempo = makeWorkout({ id: 100, distance_target_meters: 5000 })

  it('links the closest activity (parkrun), not the first-processed warm-up', () => {
    const plan = buildMatchPlan([warmup, parkrun, cooldown], [tempo], null)
    expect(plan).toHaveLength(1)
    expect(plan[0].activityId).toBe(parkrun.id)
    expect(plan[0].workoutId).toBe(tempo.id)
  })

  it('is order-independent (parkrun wins even when listed last)', () => {
    const plan = buildMatchPlan([cooldown, warmup, parkrun], [tempo], null)
    expect(plan).toHaveLength(1)
    expect(plan[0].activityId).toBe(parkrun.id)
  })

  it('assigns each workout to only one activity', () => {
    const plan = buildMatchPlan([warmup, parkrun, cooldown], [tempo], null)
    const workoutIds = plan.map(m => m.workoutId)
    expect(new Set(workoutIds).size).toBe(workoutIds.length)
  })
})

describe('buildMatchPlan — multiple activities, multiple workouts', () => {
  it('assigns best pairs globally rather than first-come', () => {
    const easyWorkout = makeWorkout({ id: 200, workout_type: 'easy_run', distance_target_meters: 8000 })
    const tempoWorkout = makeWorkout({ id: 201, workout_type: 'tempo', distance_target_meters: 5000 })
    const easyRun = makeActivity({ id: 1, distance_meters: 8000, start_time: '2026-05-26T07:00:00Z' })
    const tempoRun = makeActivity({ id: 2, distance_meters: 5000, start_time: '2026-05-26T17:00:00Z' })

    const plan = buildMatchPlan([easyRun, tempoRun], [easyWorkout, tempoWorkout], null)
    expect(plan).toHaveLength(2)
    const byActivity = new Map(plan.map(m => [m.activityId, m.workoutId]))
    expect(byActivity.get(easyRun.id)).toBe(easyWorkout.id)
    expect(byActivity.get(tempoRun.id)).toBe(tempoWorkout.id)
  })
})
