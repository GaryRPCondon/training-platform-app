import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mock every collaborator so the test isolates engine orchestration. ---
vi.mock('@/lib/agent/factory', () => ({
  createLLMProvider: vi.fn(() => ({
    generateResponse: vi.fn().mockResolvedValue({
      content: '{}',
      model: 'mock-model',
      usage: { inputTokens: 100, outputTokens: 200 },
    }),
  })),
}))
vi.mock('@/lib/agent/llm-logger', () => ({ writeLLMLog: vi.fn() }))
vi.mock('@/lib/plans/response-parser', () => ({
  parseLLMResponse: vi.fn(() => ({ weeks: [{ week_number: 1, phase: null, workouts: [] }] })),
}))
vi.mock('@/lib/plans/derive-totals', () => ({ deriveTotals: vi.fn() }))
vi.mock('@/lib/plans/structured-workout-builder', () => ({
  enrichParsedWorkouts: vi.fn(),
  enrichPreWeekWorkouts: vi.fn(),
}))
vi.mock('@/lib/plans/structural-assertions', () => ({
  runStructuralAssertions: vi.fn(() => ({ advisory: [], blocking: [] })),
  assertWeekStructure: vi.fn(() => []),
  assertRaceDay: vi.fn(() => []),
  assertSessionsHaveMainSet: vi.fn(() => []),
}))
vi.mock('@/lib/plans/plan-writer', () => ({
  writePlanToDatabase: vi.fn().mockResolvedValue({ workoutsCreated: 42 }),
}))
vi.mock('@/lib/supabase/plan-activation', () => ({ archivePlanAndGoal: vi.fn() }))

import { generatePlan, ActivePlanExistsError } from '@/lib/plans/plan-generation-engine'
import { createLLMProvider } from '@/lib/agent/factory'
import { writePlanToDatabase } from '@/lib/plans/plan-writer'
import { archivePlanAndGoal } from '@/lib/supabase/plan-activation'
import {
  runStructuralAssertions,
  assertWeekStructure,
} from '@/lib/plans/structural-assertions'

function makeSupabase(ctx: {
  activePlan?: { id: number; name: string } | null
  existingDrafts?: Array<{ id: number }>
  goalId?: number
  planId?: number
}) {
  const calls = { inserts: [] as Array<{ table: string; payload: any }>, updates: [] as Array<{ table: string; payload: any }> }
  function from(table: string) {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      in: () => Promise.resolve({ data: ctx.existingDrafts ?? [], error: null }),
      update: (payload: any) => { calls.updates.push({ table, payload }); return chain },
      delete: () => chain,
      insert: (payload: any) => { calls.inserts.push({ table, payload }); return chain },
      maybeSingle: () => Promise.resolve({ data: ctx.activePlan ?? null, error: null }),
      single: () => Promise.resolve({
        data: table === 'athlete_goals' ? { id: ctx.goalId ?? 10 } : { id: ctx.planId ?? 20 },
        error: null,
      }),
      then: (res: any) => Promise.resolve({ data: null, error: null }).then(res),
    }
    return chain
  }
  return { supabase: { from } as any, calls }
}

function baseInput(supabase: any, over: Record<string, unknown> = {}) {
  return {
    supabase,
    athleteId: 'athlete-1',
    athlete: { preferred_llm_provider: 'gemini', preferred_llm_model: null, vdot: 50 },
    systemPrompt: 'SYS',
    userMessage: 'USER',
    startDate: '2026-01-05',
    planStartDate: '2026-01-05',
    goalDate: '2026-04-19',
    weeksNeeded: 15,
    raceDayNumber: 7,
    goalName: 'Spring Marathon',
    planName: 'Spring Marathon',
    goalType: 'marathon',
    distanceMeters: 42195,
    vdot: null,
    trainingPaces: null,
    paceSource: null,
    paceSourceData: null,
    planFields: {},
    llmLogKey: 'test-generate',
    ...over,
  } as any
}

describe('generatePlan (shared engine)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('happy path: inserts goal + plan, writes workouts, runs the LLM, returns ids', async () => {
    const { supabase, calls } = makeSupabase({ activePlan: null, planId: 99 })
    const onPlanCreated = vi.fn()
    const result = await generatePlan(baseInput(supabase, {
      planFields: { source: 'import', imported_run_plan_id: 7 },
      onPlanCreated,
    }))

    expect(createLLMProvider).toHaveBeenCalledOnce()
    expect(result).toEqual({ planId: 99, summary: { workoutsCreated: 42 }, tokenUsage: { inputTokens: 100, outputTokens: 200 } })

    const goalInsert = calls.inserts.find(i => i.table === 'athlete_goals')
    const planInsert = calls.inserts.find(i => i.table === 'training_plans')
    expect(goalInsert?.payload).toMatchObject({ goal_name: 'Spring Marathon', target_value: { distance_meters: 42195 } })
    // base fields + spread provenance both present
    expect(planInsert?.payload).toMatchObject({
      name: 'Spring Marathon', status: 'draft_generated', created_by: 'agent',
      source: 'import', imported_run_plan_id: 7,
    })
    expect(writePlanToDatabase).toHaveBeenCalledOnce()
    expect(onPlanCreated).toHaveBeenCalledWith(99)
  })

  it('throws ActivePlanExistsError when an active plan exists and replace is off', async () => {
    const { supabase } = makeSupabase({ activePlan: { id: 5, name: 'Current' } })
    await expect(generatePlan(baseInput(supabase))).rejects.toBeInstanceOf(ActivePlanExistsError)
    expect(createLLMProvider).not.toHaveBeenCalled() // guard is before the billable call
  })

  it('archives the active plan when replaceActive is true', async () => {
    const { supabase } = makeSupabase({ activePlan: { id: 5, name: 'Current' }, planId: 77 })
    const result = await generatePlan(baseInput(supabase, { replaceActive: true }))
    expect(archivePlanAndGoal).toHaveBeenCalledWith(supabase, 5, 'athlete-1')
    expect(result.planId).toBe(77)
  })

  it('throws on blocking structural failure and does not insert a plan', async () => {
    vi.mocked(assertWeekStructure).mockReturnValueOnce(['Expected 15 weeks, got 3'])
    const { supabase, calls } = makeSupabase({ activePlan: null })
    await expect(generatePlan(baseInput(supabase))).rejects.toThrow(/structural validation/)
    expect(calls.inserts.find(i => i.table === 'training_plans')).toBeUndefined()
  })

  it('uses runStructuralAssertions when a template is supplied', async () => {
    const { supabase } = makeSupabase({ activePlan: null })
    await generatePlan(baseInput(supabase, { template: { name: 'T', weekly_schedule: [] } }))
    expect(runStructuralAssertions).toHaveBeenCalledOnce()
    expect(assertWeekStructure).not.toHaveBeenCalled()
  })
})
