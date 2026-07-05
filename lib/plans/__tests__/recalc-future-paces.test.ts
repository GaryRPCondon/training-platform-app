import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock the template loader; use real vdot + pace-resolver math.
// Factory must not reference outer consts (hoisting rule) — define inline.
// ---------------------------------------------------------------------------
vi.mock('@/lib/templates/template-loader', () => ({
  loadFullTemplate: vi.fn(),
}))

import { recalcActivePlanFuturePaces } from '../recalc-future-paces'
import { loadFullTemplate } from '@/lib/templates/template-loader'

const mockLoadTemplate = vi.mocked(loadFullTemplate)

// Hansons-style template: "tempo" resolves to marathon pace.
const TEMPLATE = {
  pace_targets: {
    easy: { reference_pace: 'easy', description: 'Conversational' },
    tempo: { reference_pace: 'marathon', description: 'Marathon goal pace' },
  },
} as any

// ---------------------------------------------------------------------------
// Table-routed Supabase mock. Each table returns a thenable query builder;
// planned_workouts.update calls are recorded for assertions.
// ---------------------------------------------------------------------------
interface MockOpts {
  plan?: any
  phases?: any[]
  weeks?: any[]
  workouts?: any[]
}

function makeSupabase(opts: MockOpts) {
  const updates: Array<{ id: any; payload: any }> = []

  // A self-chaining, awaitable builder for the .update(...).eq(...).eq(...) path.
  function updateChain(payload: any): any {
    const chain: any = {
      eq: vi.fn((col: string, val: any) => {
        if (col === 'id') updates.push({ id: val, payload })
        return chain
      }),
    }
    chain.then = (onfulfilled: any, onrejected?: any) =>
      Promise.resolve({ data: null, error: null }).then(onfulfilled, onrejected)
    return chain
  }

  function builder(result: any): any {
    const mock: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: result, error: null }),
      update: vi.fn((payload: any) => updateChain(payload)),
    }
    mock.then = (onfulfilled: any, onrejected?: any) =>
      Promise.resolve({ data: result, error: null }).then(onfulfilled, onrejected)
    return mock
  }

  const from = vi.fn((table: string) => {
    switch (table) {
      case 'training_plans':
        return builder(opts.plan ?? null)
      case 'training_phases':
        return builder(opts.phases ?? [])
      case 'weekly_plans':
        return builder(opts.weeks ?? [])
      case 'planned_workouts':
        return builder(opts.workouts ?? [])
      default:
        return builder(null)
    }
  })

  return { supabase: { from } as any, updates }
}

// A future tempo workout, already carrying a stamped pace (stale VDOT ~45).
function futureTempoWorkout(overrides: Record<string, any> = {}) {
  return {
    id: 'w-future',
    workout_type: 'tempo',
    intensity_target: 'tempo',
    distance_target_meters: 10000,
    structured_workout: {
      warmup: { distance_meters: 1000 },
      main_set: [{ repeat: 1, intervals: [{ distance_meters: 8000, intensity: 'tempo' }] }],
      cooldown: { distance_meters: 1000 },
      target_pace_sec_per_km: 300, // old baked pace
      pace_label: 'tempo',
    },
    garmin_workout_id: null,
    garmin_sync_status: null,
    ...overrides,
  }
}

const ATHLETE = 'athlete-1'
const ACTIVE_PLAN = { id: 'plan-1', template_id: 'hansons', vdot: 50, status: 'active' }

describe('recalcActivePlanFuturePaces', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLoadTemplate.mockResolvedValue(TEMPLATE)
  })

  it('re-stamps an already-stamped future workout to the new VDOT pace', async () => {
    const { supabase, updates } = makeSupabase({
      plan: ACTIVE_PLAN,
      phases: [{ id: 'ph-1' }],
      weeks: [{ id: 'wk-1' }],
      workouts: [futureTempoWorkout()],
    })

    const result = await recalcActivePlanFuturePaces(supabase, ATHLETE)

    expect(result).toEqual({ repaced: 1, skipped: null })
    expect(updates).toHaveLength(1)
    const sw = updates[0].payload.structured_workout
    // Overwritten (unconditional re-stamp), and to a real resolved value.
    expect(sw.pace_source).toBe('template')
    expect(sw.target_pace_sec_per_km).not.toBe(300)
    expect(typeof sw.target_pace_sec_per_km).toBe('number')
    // Distance recomputed for the full session.
    expect(updates[0].payload.distance_target_meters).toBeGreaterThan(0)
  })

  it('marks synced Garmin workouts stale so they get re-exported', async () => {
    const { supabase, updates } = makeSupabase({
      plan: ACTIVE_PLAN,
      phases: [{ id: 'ph-1' }],
      weeks: [{ id: 'wk-1' }],
      workouts: [
        futureTempoWorkout({ garmin_workout_id: 'g-1', garmin_sync_status: 'synced' }),
      ],
    })

    await recalcActivePlanFuturePaces(supabase, ATHLETE)

    expect(updates[0].payload.garmin_sync_status).toBe('stale')
  })

  it('does not mark unsynced Garmin workouts stale', async () => {
    const { supabase, updates } = makeSupabase({
      plan: ACTIVE_PLAN,
      phases: [{ id: 'ph-1' }],
      weeks: [{ id: 'wk-1' }],
      workouts: [futureTempoWorkout({ garmin_workout_id: 'g-1', garmin_sync_status: 'stale' })],
    })

    await recalcActivePlanFuturePaces(supabase, ATHLETE)

    expect(updates[0].payload.garmin_sync_status).toBeUndefined()
  })

  it('skips a workout whose intensity is not in the template pace_targets', async () => {
    const { supabase, updates } = makeSupabase({
      plan: ACTIVE_PLAN,
      phases: [{ id: 'ph-1' }],
      weeks: [{ id: 'wk-1' }],
      workouts: [futureTempoWorkout({ intensity_target: 'sprint_unknown' })],
    })

    const result = await recalcActivePlanFuturePaces(supabase, ATHLETE)

    expect(result.repaced).toBe(0)
    expect(updates).toHaveLength(0)
  })

  it('skips a workout with no structured main_set', async () => {
    const { supabase, updates } = makeSupabase({
      plan: ACTIVE_PLAN,
      phases: [{ id: 'ph-1' }],
      weeks: [{ id: 'wk-1' }],
      workouts: [futureTempoWorkout({ structured_workout: { note: 'rest day' } })],
    })

    const result = await recalcActivePlanFuturePaces(supabase, ATHLETE)

    expect(result.repaced).toBe(0)
    expect(updates).toHaveLength(0)
  })

  it('no-ops with a skip reason when the plan has no template (imported plan)', async () => {
    const { supabase, updates } = makeSupabase({
      plan: { id: 'plan-2', template_id: null, vdot: 50, status: 'active' },
    })

    const result = await recalcActivePlanFuturePaces(supabase, ATHLETE)

    expect(result).toEqual({ repaced: 0, skipped: 'no_template' })
    expect(updates).toHaveLength(0)
    expect(mockLoadTemplate).not.toHaveBeenCalled()
  })

  it('no-ops when there is no active plan', async () => {
    const { supabase } = makeSupabase({ plan: null })

    const result = await recalcActivePlanFuturePaces(supabase, ATHLETE)

    expect(result).toEqual({ repaced: 0, skipped: 'no_active_plan' })
  })

  it('no-ops when the active plan has no VDOT', async () => {
    const { supabase } = makeSupabase({
      plan: { id: 'plan-3', template_id: 'hansons', vdot: null, status: 'active' },
    })

    const result = await recalcActivePlanFuturePaces(supabase, ATHLETE)

    expect(result).toEqual({ repaced: 0, skipped: 'no_vdot' })
  })
})
