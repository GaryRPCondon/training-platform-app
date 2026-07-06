import { describe, it, expect } from 'vitest'
import { plansOverlap, truncateAndArchivePlan } from '@/lib/supabase/plan-activation'

describe('plansOverlap', () => {
  it('returns true for overlapping ranges', () => {
    expect(plansOverlap('2026-01-05', '2026-04-19', '2026-01-01', '2026-03-01')).toBe(true)
  })

  it('returns true when one range fully contains the other', () => {
    expect(plansOverlap('2026-02-01', '2026-02-10', '2026-01-01', '2026-12-31')).toBe(true)
  })

  it('returns true when ranges touch on a single day (shared boundary)', () => {
    expect(plansOverlap('2026-03-01', '2026-06-01', '2026-01-01', '2026-03-01')).toBe(true)
  })

  it('returns false for consecutive, non-overlapping ranges', () => {
    // New plan starts the day after the old plan ends.
    expect(plansOverlap('2026-01-01', '2026-04-19', '2025-09-01', '2025-12-31')).toBe(false)
  })

  it('returns false regardless of argument order', () => {
    expect(plansOverlap('2025-09-01', '2025-12-31', '2026-01-01', '2026-04-19')).toBe(false)
  })
})

/**
 * Minimal thenable Supabase stub: every query builder method returns the chain,
 * the chain resolves (await) to a per-table payload, and `.single()` resolves to
 * a per-table single row. Records update/delete calls for assertions.
 */
function makeSupabase(data: {
  phases: Array<{ id: number }>
  weeks: Array<{ id: number }>
}) {
  const calls = {
    updates: [] as Array<{ table: string; payload: any }>,
    deletes: [] as Array<{ table: string }>,
  }
  function from(table: string) {
    const tableData = table === 'training_phases' ? data.phases : table === 'weekly_plans' ? data.weeks : null
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      gte: () => chain,
      neq: () => chain,
      update: (payload: any) => { calls.updates.push({ table, payload }); return chain },
      delete: () => { calls.deletes.push({ table }); return chain },
      single: () => Promise.resolve({ data: { goal_id: 42 }, error: null }),
      then: (res: any) => Promise.resolve({ data: tableData, error: null }).then(res),
    }
    return chain
  }
  return { supabase: { from } as any, calls }
}

describe('truncateAndArchivePlan', () => {
  it('deletes on/after-cutoff weeks, orphans completed workouts, and archives the plan + goal', async () => {
    const { supabase, calls } = makeSupabase({ phases: [{ id: 1 }, { id: 2 }], weeks: [{ id: 10 }, { id: 11 }] })

    await truncateAndArchivePlan(supabase, 5, 'athlete-1', '2026-01-05')

    // Completed/non-scheduled workouts orphaned before the weekly_plans are deleted.
    const orphan = calls.updates.find(u => u.table === 'planned_workouts')
    expect(orphan?.payload).toEqual({ weekly_plan_id: null })

    // The colliding weekly_plans are removed (cascades their scheduled workouts).
    expect(calls.deletes.some(d => d.table === 'weekly_plans')).toBe(true)

    // Plan shortened to the day before the cutoff and archived.
    const planUpdate = calls.updates.find(u => u.table === 'training_plans')
    expect(planUpdate?.payload).toEqual({ status: 'archived', end_date: '2026-01-04' })

    // Linked goal abandoned.
    const goalUpdate = calls.updates.find(u => u.table === 'athlete_goals')
    expect(goalUpdate?.payload).toEqual({ status: 'abandoned' })
  })

  it('skips week/workout deletion when the plan has no on/after-cutoff weeks', async () => {
    const { supabase, calls } = makeSupabase({ phases: [{ id: 1 }], weeks: [] })

    await truncateAndArchivePlan(supabase, 5, 'athlete-1', '2026-01-05')

    expect(calls.deletes.some(d => d.table === 'weekly_plans')).toBe(false)
    expect(calls.updates.find(u => u.table === 'planned_workouts')).toBeUndefined()
    // Still archives the plan itself.
    expect(calls.updates.find(u => u.table === 'training_plans')?.payload).toEqual({
      status: 'archived',
      end_date: '2026-01-04',
    })
  })
})
