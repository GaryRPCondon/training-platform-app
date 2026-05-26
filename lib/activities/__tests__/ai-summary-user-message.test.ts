import { describe, it, expect } from 'vitest'
import { buildUserMessage } from '../ai-summary'
import type { Activity, Lap, PlannedWorkout } from '@/types/database'

function makeWorkout(overrides: Partial<PlannedWorkout> = {}): PlannedWorkout {
  return {
    id: 1,
    weekly_plan_id: 1,
    athlete_id: 'a',
    scheduled_date: '2026-05-26',
    scheduled_time: null,
    workout_type: 'intervals',
    workout_index: 'Q1',
    session_order: 1,
    description: '5 × 1km at T pace, 60s recovery jogs (11 km total)',
    distance_target_meters: 11000,
    duration_target_seconds: null,
    intensity_target: 'T',
    structured_workout: {
      warmup: { distance_meters: 3000, intensity: 'E' },
      main_set: [
        { repeat: 5, intervals: [
          { distance_meters: 1000, intensity: 'T' },
          { duration_seconds: 60, intensity: 'E' },
        ]},
      ],
      cooldown: { distance_meters: 3000, intensity: 'E' },
      target_pace_sec_per_km: 245,
    },
    status: 'completed',
    completed_activity_id: 1,
    completion_status: 'completed',
    completion_metadata: null,
    agent_rationale: null,
    agent_decision_metadata: null,
    notes: null,
    version: 1,
    created_at: '',
    updated_at: '',
    garmin_workout_id: null,
    garmin_scheduled_at: null,
    garmin_sync_status: null,
    ...overrides,
  }
}

function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 1,
    athlete_id: 'a',
    garmin_id: 1,
    strava_id: null,
    source: 'garmin',
    activity_name: 'Run',
    activity_type: 'running',
    start_time: '2026-05-26T07:00:00Z',
    distance_meters: 11000,
    duration_seconds: 3300,
    moving_duration_seconds: 3300,
    elevation_gain_meters: null,
    elevation_loss_meters: null,
    avg_hr: 155,
    max_hr: 175,
    min_hr: null,
    avg_power: null,
    max_power: null,
    normalized_power: null,
    avg_cadence: null,
    max_cadence: null,
    calories: null,
    perceived_effort: null,
    notes: null,
    planned_workout_id: 1,
    garmin_data: null,
    strava_data: null,
    synced_from_garmin: null,
    synced_from_strava: null,
    hr_zones: null,
    has_detail_data: true,
    match_confidence: null,
    match_method: null,
    match_metadata: null,
    ai_summary: null,
    ai_summary_status: 'none',
    ai_star_rating: null,
    ai_summary_generated_at: null,
    garmin_description: null,
    strava_description: null,
    garmin_summary_pushed_at: null,
    strava_summary_pushed_at: null,
    garmin_push_failed_at: null,
    strava_push_failed_at: null,
    created_at: '',
    ...overrides,
  }
}

function makeLap(i: number, overrides: Partial<Lap> = {}): Lap {
  return {
    id: i,
    activity_id: 1,
    lap_index: i,
    distance_meters: 1000,
    duration_seconds: 240,
    avg_hr: 160,
    max_hr: 170,
    avg_power: null,
    avg_pace: 240,
    elevation_gain_meters: 0,
    raw_data: null,
    source: 'garmin',
    split_type: null,
    intensity_type: null,
    avg_cadence: null,
    max_speed: null,
    normalized_power: null,
    ground_contact_time: null,
    stride_length: null,
    vertical_oscillation: null,
    wkt_step_index: null,
    compliance_score: null,
    ...overrides,
  }
}

// Lap fixture matching the user's 5x1km T-pace session: warmup, 5 reps with
// recoveries, cooldown. Active reps slightly fast (high score),
// recoveries hit target (high score), warmup/cooldown easy (high score).
function intervalLaps(): Lap[] {
  const laps: Lap[] = []
  let idx = 0
  laps.push(makeLap(idx++, { distance_meters: 3000, duration_seconds: 990, avg_pace: 330, intensity_type: 'WARMUP', compliance_score: 95 }))
  for (let i = 0; i < 5; i++) {
    laps.push(makeLap(idx++, { distance_meters: 1000, duration_seconds: 235, avg_pace: 235, intensity_type: 'ACTIVE', compliance_score: 78 }))
    laps.push(makeLap(idx++, { distance_meters: 200, duration_seconds: 60, avg_pace: 300, intensity_type: 'RECOVERY', compliance_score: 92 }))
  }
  laps.push(makeLap(idx++, { distance_meters: 3000, duration_seconds: 990, avg_pace: 330, intensity_type: 'COOLDOWN', compliance_score: 95 }))
  return laps
}

describe('buildUserMessage — intervals workout', () => {
  it('labels the target pace as work-reps-only', () => {
    const msg = buildUserMessage(makeActivity(), makeWorkout(), intervalLaps())
    expect(msg).toContain('Target pace (work reps only): 4:05/km')
    expect(msg).not.toMatch(/^- Target pace: 4:05\/km/m)
  })

  it('emits a workout structure block from structured_workout.main_set', () => {
    const msg = buildUserMessage(makeActivity(), makeWorkout(), intervalLaps())
    expect(msg).toContain('Workout structure:')
    expect(msg).toContain('Warmup: 3.00 km @ E')
    expect(msg).toContain('Main set: 5 × (1.00 km @ T + 1 min @ E)')
    expect(msg).toContain('Cooldown: 3.00 km @ E')
  })

  it('averages pace compliance over ACTIVE laps only, not warmup/recovery/cooldown', () => {
    const msg = buildUserMessage(makeActivity(), makeWorkout(), intervalLaps())
    // ACTIVE laps all 78 → headline must be 78%, not the diluted 86-ish all-lap avg.
    expect(msg).toContain('Active-rep pace compliance: 78%')
    expect(msg).not.toContain('Pace compliance: 78%')
  })

  it('shows lap Role column and omits adherence on non-active laps', () => {
    const msg = buildUserMessage(makeActivity(), makeWorkout(), intervalLaps())
    expect(msg).toContain('Role | Adherence%')
    // ACTIVE lap row: ends with the lap's compliance score
    expect(msg).toMatch(/\| ACTIVE \| 78%/)
    // Non-active rows show em-dash for adherence, not the misleading raw score
    expect(msg).toMatch(/\| WARMUP \| —/)
    expect(msg).toMatch(/\| RECOVERY \| —/)
    expect(msg).toMatch(/\| COOLDOWN \| —/)
  })

  it('falls back to all-lap compliance when no laps are tagged ACTIVE/INTERVAL', () => {
    const untagged = intervalLaps().map(l => ({ ...l, intensity_type: null, compliance_score: 80 }))
    const msg = buildUserMessage(makeActivity(), makeWorkout(), untagged)
    expect(msg).toContain('Pace compliance: 80%')
    expect(msg).not.toContain('Active-rep pace compliance')
  })

  it('tells the LLM to state pace direction explicitly', () => {
    const msg = buildUserMessage(makeActivity(), makeWorkout(), intervalLaps())
    expect(msg).toContain('too fast, too slow, or on target')
  })
})

describe('buildUserMessage — easy run', () => {
  function easyWorkout(): PlannedWorkout {
    return makeWorkout({
      workout_type: 'easy_run',
      description: '8 km easy',
      distance_target_meters: 8000,
      intensity_target: 'easy',
      structured_workout: { pace_guidance: 'easy', target_pace_sec_per_km: 320 },
    })
  }

  it('keeps the existing single-target-pace label for easy runs', () => {
    const laps = [makeLap(0, { distance_meters: 8000, duration_seconds: 2560, avg_pace: 320, compliance_score: 90 })]
    const msg = buildUserMessage(makeActivity({ distance_meters: 8000, duration_seconds: 2560, moving_duration_seconds: 2560 }), easyWorkout(), laps)
    expect(msg).toContain('Target pace: 5:20/km')
    expect(msg).not.toContain('Target pace (work reps only)')
  })

  it('does not emit a structure block when main_set is absent', () => {
    const msg = buildUserMessage(makeActivity(), easyWorkout(), [])
    expect(msg).not.toContain('Workout structure:')
  })

  it('does not emit a pace-compliance line for low-intensity workouts', () => {
    const laps = [makeLap(0, { compliance_score: 60 })]
    const msg = buildUserMessage(makeActivity(), easyWorkout(), laps)
    expect(msg).not.toMatch(/Pace compliance:/)
  })
})
