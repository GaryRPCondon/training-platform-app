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
    expect(msg).toContain('Workout structure')
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

  it('renders a Duration column with mm:ss lap times', () => {
    const msg = buildUserMessage(makeActivity(), makeWorkout(), intervalLaps())
    expect(msg).toContain('Distance | Duration | Pace')
    // ACTIVE lap: 235s → 3:55
    expect(msg).toMatch(/\| 3:55 \| 3:55\/km/)
    // RECOVERY lap: 60s → 1:00
    expect(msg).toMatch(/\| 1:00 \|/)
  })

  it('annotates active laps with signed deviation vs target (faster reads as fast, not a fade)', () => {
    const msg = buildUserMessage(makeActivity(), makeWorkout(), intervalLaps())
    // ACTIVE laps run 235s vs 245s target → 10s fast, despite a lower 78% score.
    expect(msg).toContain('Adherence% (vs target)')
    expect(msg).toMatch(/\| ACTIVE \| 78% \(10s fast\)/)
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

describe('buildUserMessage — custom per-interval pace (no numeric stamp)', () => {
  // Regression: a structured workout with an athlete-specified custom pace stores it
  // only as a `target_pace` string on the interval, not target_pace_sec_per_km. The
  // summary reported "No target pace was provided" and couldn't assess compliance.
  function customWorkout(): PlannedWorkout {
    return makeWorkout({
      workout_type: 'tempo',
      intensity_target: 'custom',
      distance_target_meters: 10000,
      structured_workout: {
        main_set: [{ repeat: 1, intervals: [{ distance_meters: 10000, intensity: 'custom', target_pace: '3:45' }] }],
      },
    })
  }

  it('resolves the target pace from the interval target_pace string', () => {
    const msg = buildUserMessage(makeActivity(), customWorkout(), intervalLaps())
    expect(msg).toContain('Target pace (work reps only): 3:45/km')
    expect(msg).not.toContain('Target pace (work reps only): N/A')
  })

  it('shows the custom pace in the structure block', () => {
    const msg = buildUserMessage(makeActivity(), customWorkout(), intervalLaps())
    expect(msg).toContain('10.0 km @ custom (3:45)')
  })

  it('resolves a simple workout custom pace from the top-level target_pace string', () => {
    const simple = makeWorkout({
      workout_type: 'race',
      intensity_target: 'custom',
      distance_target_meters: 10000,
      structured_workout: { target_pace: '3:55' },
    })
    const msg = buildUserMessage(makeActivity(), simple, intervalLaps())
    expect(msg).toContain('3:55/km')
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

  it('labels the easy pace as an upper limit, not a target', () => {
    const laps = [makeLap(0, { distance_meters: 8000, duration_seconds: 2560, avg_pace: 320, compliance_score: 90 })]
    const msg = buildUserMessage(makeActivity({ distance_meters: 8000, duration_seconds: 2560, moving_duration_seconds: 2560 }), easyWorkout(), laps)
    expect(msg).toContain('Easy pace (upper limit): 5:20/km')
    expect(msg).not.toContain('Target pace (work reps only)')
    // "Target" framing is what made a slower-than-easy run read as a shortfall.
    expect(msg).not.toContain('Target pace: 5:20/km')
  })

  it('keeps the label free of quotable phrasing the model can parrot', () => {
    // Regression: "Easy pace ceiling (slower is fine; faster is the fault)" came back
    // out verbatim-ish in summaries ("the overall pace was slower than the easy pace
    // ceiling, which aligns with the intent of an easy run") — rubric narration, not
    // coaching. The data label must not hand the model a phrase to quote.
    const msg = buildUserMessage(makeActivity(), easyWorkout(), [])
    expect(msg).not.toMatch(/ceiling/i)
    expect(msg).not.toContain('slower is fine')
  })

  it('does not emit a structure block when main_set is absent', () => {
    const msg = buildUserMessage(makeActivity(), easyWorkout(), [])
    expect(msg).not.toContain('Workout structure')
  })

  it('tells the model that slower than easy pace is not a fault', () => {
    // Regression (planned_workout 11656): a 5:38/km run at 115 bpm against a 5:05/km
    // easy pace was summarised as having "drifted significantly slower than the
    // target … failed to meet the intent". Easy pace bounds effort from above; only
    // running faster than it is a fault.
    const msg = buildUserMessage(makeActivity(), easyWorkout(), [])
    expect(msg).toContain('an upper limit, not a target')
    expect(msg).toContain('running slower than it is not a shortfall')
  })

  it('tells the model to leave pace out of the summary when the run was not too fast', () => {
    // The rule is for judging, not for narrating: a compliant easy run should read as
    // coaching, not as a report that the pace rule was satisfied.
    const msg = buildUserMessage(makeActivity(), easyWorkout(), [])
    expect(msg).toContain('leave pace out of the summary entirely')
    expect(msg).toContain('do not name individual laps')
  })

  it('does not emit a pace-compliance line for low-intensity workouts', () => {
    const laps = [makeLap(0, { compliance_score: 60 })]
    const msg = buildUserMessage(makeActivity(), easyWorkout(), laps)
    expect(msg).not.toMatch(/Pace compliance:/)
  })

  it('stays on the overall-pace path for a long run with no quality segments', () => {
    const plainLong = makeWorkout({
      workout_type: 'long_run',
      description: 'Long 18 km easy',
      distance_target_meters: 18000,
      intensity_target: 'easy',
      structured_workout: {
        main_set: [{ repeat: 1, intervals: [{ role: 'work', intensity: 'easy', distance_meters: 18000 }] }],
        target_pace_sec_per_km: 309,
      },
    })
    const msg = buildUserMessage(makeActivity(), plainLong, [])
    // 'overall' mode: whole-run HR and effort control against an upper limit.
    expect(msg).toContain('The easy pace below is an upper limit, not a target')
    expect(msg).toContain('Easy pace (upper limit): 5:09/km')
    expect(msg).not.toContain('MULTI-PACE session')
    expect(msg).not.toContain('judge success on per-lap pace compliance')
  })
})

// Regression: planned_workout 11668 — "Long 12 mi (19 km) — 2E + 2 × (1T w/1 min
// rests) + 30 min E + 2 × (1T w/1 min rests) + 2E". Classified on workout_type alone
// this took the easy-run path, so the model was told to judge the whole-activity
// average (4:45/km) against the stamped T pace (4:02/km) and reported the tempo reps
// as "significantly slower" when every rep was in fact faster than target.
describe('buildUserMessage — long run with embedded tempo reps', () => {
  const paces = { easy: 309, marathon: 256, tempo: 242, interval: 222, repetition: 208, walk: 600 }

  function mixedLongRun(): PlannedWorkout {
    return makeWorkout({
      workout_type: 'long_run',
      description: 'Long 12 mi. (19 km) — 2E + 2 × (1T w/1 min rests) + 30 min E + 2 × (1T w/1 min rests) + 2E',
      distance_target_meters: 18697,
      intensity_target: 'tempo',
      structured_workout: {
        main_set: [
          { repeat: 1, intervals: [{ role: 'warmup', intensity: 'easy', distance_meters: 3218 }] },
          { repeat: 2, intervals: [
            { role: 'work', intensity: 'tempo', distance_meters: 1609 },
            { role: 'rest', intensity: 'rest', duration_seconds: 60 },
          ] },
          { repeat: 1, intervals: [{ role: 'recovery', intensity: 'easy', duration_seconds: 1800 }] },
          { repeat: 2, intervals: [
            { role: 'work', intensity: 'tempo', distance_meters: 1609 },
            { role: 'rest', intensity: 'rest', duration_seconds: 60 },
          ] },
          { repeat: 1, intervals: [{ role: 'cooldown', intensity: 'easy', distance_meters: 3218 }] },
        ],
        pace_label: 'tempo',
        target_pace_sec_per_km: 242,
      },
    })
  }

  function mixedLaps(): Lap[] {
    const laps: Lap[] = []
    let idx = 0
    for (let i = 0; i < 3; i++) laps.push(makeLap(idx++, { distance_meters: 1000, duration_seconds: 310, avg_pace: 310, intensity_type: 'WARMUP', compliance_score: 55 }))
    // Work reps run FAST: 3:52/km against a 4:02 target.
    for (let i = 0; i < 2; i++) {
      laps.push(makeLap(idx++, { distance_meters: 1609, duration_seconds: 373, avg_pace: 232, intensity_type: 'ACTIVE', compliance_score: 88 }))
      laps.push(makeLap(idx++, { distance_meters: 100, duration_seconds: 60, avg_pace: 600, intensity_type: 'REST', compliance_score: 26 }))
    }
    for (let i = 0; i < 6; i++) laps.push(makeLap(idx++, { distance_meters: 1000, duration_seconds: 303, avg_pace: 303, intensity_type: 'RECOVERY', compliance_score: 50 }))
    for (let i = 0; i < 2; i++) {
      laps.push(makeLap(idx++, { distance_meters: 1609, duration_seconds: 373, avg_pace: 232, intensity_type: 'ACTIVE', compliance_score: 88 }))
      laps.push(makeLap(idx++, { distance_meters: 100, duration_seconds: 60, avg_pace: 600, intensity_type: 'REST', compliance_score: 26 }))
    }
    for (let i = 0; i < 3; i++) laps.push(makeLap(idx++, { distance_meters: 1000, duration_seconds: 303, avg_pace: 303, intensity_type: 'COOLDOWN', compliance_score: null }))
    return laps
  }

  const activity = () => makeActivity({ distance_meters: 19160, duration_seconds: 6136, moving_duration_seconds: 5469, avg_hr: 128 })

  it('evaluates as multi-pace, not on the whole-activity average', () => {
    const msg = buildUserMessage(activity(), mixedLongRun(), mixedLaps(), paces)
    expect(msg).toContain('MULTI-PACE session')
    expect(msg).not.toContain('judge success on overall average pace')
  })

  it('labels the target pace as work-reps-only and warns off the blended average', () => {
    const msg = buildUserMessage(activity(), mixedLongRun(), mixedLaps(), paces)
    expect(msg).toContain('Target pace (work reps only): 4:02/km')
    expect(msg).toContain('blend of easy and work segments')
  })

  it('surfaces per-lap adherence with direction for the work reps', () => {
    const msg = buildUserMessage(activity(), mixedLongRun(), mixedLaps(), paces)
    // The reps were 10s/km FASTER than target — the old easy-run path suppressed this
    // entirely and the model guessed "slower".
    expect(msg).toContain('88% (10s fast)')
    expect(msg).toContain('Active-rep pace compliance: 88%')
  })

  it('gives each structure segment its own resolved pace', () => {
    const msg = buildUserMessage(activity(), mixedLongRun(), mixedLaps(), paces)
    expect(msg).toContain('3.22 km @ easy (5:09/km)')
    expect(msg).toContain('1.61 km @ tempo (4:02/km)')
    expect(msg).toContain('30 min @ easy (5:09/km)')
  })

  it('prefers the generation-time stamp over drifted live paces for the stamped intensity', () => {
    // The stamp and the plan's current paces diverge whenever VDOT moves without a
    // re-pace run. The "Target pace" line reads the stamp, so the structure block has
    // to as well — otherwise the same segment is quoted two ways and the model is
    // invited to explain a gap that does not exist.
    const workout = mixedLongRun()
    const drifted = { ...paces, tempo: 250 } // live tempo pace has moved off the 242 stamp
    const msg = buildUserMessage(activity(), workout, mixedLaps(), drifted)

    expect(msg).toContain('Target pace (work reps only): 4:02/km')
    expect(msg).toContain('1.61 km @ tempo (4:02/km)')
    expect(msg).not.toContain('1.61 km @ tempo (4:10/km)')
    // Intensities the stamp does not cover still resolve from the live paces.
    expect(msg).toContain('30 min @ easy (5:09/km)')
  })

  it('treats a uniformly quality-paced long run as structured, not mixed', () => {
    // No easy segment means no blend, so the whole-activity average IS the target —
    // the mixed prompt would wrongly tell the model to disregard it.
    const marathonPaceLongRun = makeWorkout({
      workout_type: 'long_run',
      description: 'Long 20 km at marathon pace',
      distance_target_meters: 20000,
      intensity_target: 'marathon',
      structured_workout: {
        main_set: [{ repeat: 1, intervals: [{ role: 'work', intensity: 'marathon', distance_meters: 20000 }] }],
        pace_label: 'marathon',
        target_pace_sec_per_km: 256,
      },
    })
    const msg = buildUserMessage(activity(), marathonPaceLongRun, mixedLaps(), paces)

    expect(msg).not.toContain('MULTI-PACE session')
    expect(msg).not.toContain('blend of easy and work segments')
    expect(msg).toContain('judge success on per-lap pace compliance')
  })

  it('reports the distance as on-target once the plan distance is sized correctly', () => {
    const msg = buildUserMessage(activity(), mixedLongRun(), mixedLaps(), paces)
    // 19160 m actual vs 18697 m planned = +2.5%, not the -13.1% the inflated
    // interval-paced target produced.
    expect(msg).toContain('Distance variance vs plan: +2.5%')
  })
})
