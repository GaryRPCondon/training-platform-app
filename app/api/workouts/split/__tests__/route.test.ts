import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockRequest, makeMockSupabase } from '@/lib/__tests__/helpers/api-test-utils'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

import { createClient } from '@/lib/supabase/server'
const mockCreateClient = vi.mocked(createClient)

import { POST } from '../route'

const baseRow = {
  id: 1,
  athlete_id: 'user-1',
  scheduled_date: '2026-05-15',
  scheduled_time: null,
  workout_type: 'easy_run',
  workout_index: 'W1:D2',
  weekly_plan_id: 10,
  description: 'Easy 21k',
  distance_target_meters: 21000,
  duration_target_seconds: null,
  intensity_target: 'easy',
  structured_workout: null,
  notes: null,
  garmin_workout_id: null,
  garmin_sync_status: null,
}

function buildSupabase(opts: {
  row?: typeof baseRow | null
  fetchError?: { message: string } | null
  siblings?: Array<{ id: number }>
  insertResult?: any[] | null
  insertError?: { message: string } | null
}) {
  const { row = baseRow, fetchError = null, siblings = [], insertResult = [{ id: 2 }, { id: 3 }], insertError = null } = opts
  let phase: 'fetch-row' | 'find-siblings' | 'delete' | 'insert-children' | 'restore' = 'fetch-row'

  return makeMockSupabase({ id: 'user-1' }, () => {
    const mock: any = {
      select: (_cols?: string) => mock,
      eq: () => mock,
      neq: () => {
        phase = 'find-siblings'
        return mock
      },
      delete: () => {
        phase = 'delete'
        return mock
      },
      insert: (_payload: any[]) => {
        if (phase === 'delete') phase = 'insert-children'
        return mock
      },
      single: () => {
        if (phase === 'fetch-row') {
          return Promise.resolve({ data: row, error: fetchError })
        }
        return Promise.resolve({ data: null, error: null })
      },
    }
    // Awaiting the chain (after eq/neq) returns the array result for sibling lookup or the inserted rows.
    mock.then = (onfulfilled: any) => {
      if (phase === 'find-siblings') {
        return Promise.resolve({ data: siblings, error: null }).then(onfulfilled)
      }
      if (phase === 'delete') {
        return Promise.resolve({ data: null, error: null }).then(onfulfilled)
      }
      if (phase === 'insert-children') {
        return Promise.resolve({ data: insertResult, error: insertError }).then(onfulfilled)
      }
      return Promise.resolve({ data: null, error: null }).then(onfulfilled)
    }
    return mock
  })
}

describe('POST /api/workouts/split', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockCreateClient.mockResolvedValue(makeMockSupabase(null) as any)
    const req = createMockRequest('/api/workouts/split', {
      method: 'POST',
      body: { workoutId: 1, run1Distance: 11000, run2Distance: 10000 },
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 400 when distances are invalid', async () => {
    mockCreateClient.mockResolvedValue(makeMockSupabase({ id: 'user-1' }) as any)
    const req = createMockRequest('/api/workouts/split', {
      method: 'POST',
      body: { workoutId: 1, run1Distance: -100, run2Distance: 10000 },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 404 when workout not found', async () => {
    mockCreateClient.mockResolvedValue(buildSupabase({ row: null, fetchError: { message: 'not found' } }) as any)
    const req = createMockRequest('/api/workouts/split', {
      method: 'POST',
      body: { workoutId: 999, run1Distance: 11000, run2Distance: 10000 },
    })
    const res = await POST(req)
    expect(res.status).toBe(404)
  })

  it('rejects non-splittable workout types (intervals → 400)', async () => {
    mockCreateClient.mockResolvedValue(buildSupabase({ row: { ...baseRow, workout_type: 'intervals' } as any }) as any)
    const req = createMockRequest('/api/workouts/split', {
      method: 'POST',
      body: { workoutId: 1, run1Distance: 11000, run2Distance: 10000 },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/cannot be split/i)
  })

  it('rejects sum that drifts beyond tolerance (5%)', async () => {
    mockCreateClient.mockResolvedValue(buildSupabase({}) as any)
    const req = createMockRequest('/api/workouts/split', {
      method: 'POST',
      body: { workoutId: 1, run1Distance: 5000, run2Distance: 5000 }, // 10k vs 21k original = way over
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/within/i)
  })

  it('rejects when siblings already exist on the same date', async () => {
    mockCreateClient.mockResolvedValue(buildSupabase({ siblings: [{ id: 99 }] }) as any)
    const req = createMockRequest('/api/workouts/split', {
      method: 'POST',
      body: { workoutId: 1, run1Distance: 11000, run2Distance: 10000 },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/already has multiple/i)
  })

  it('happy path returns two inserted workouts', async () => {
    mockCreateClient.mockResolvedValue(
      buildSupabase({
        insertResult: [
          { id: 2, session_order: 1, distance_target_meters: 11000 },
          { id: 3, session_order: 2, distance_target_meters: 10000 },
        ],
      }) as any
    )
    const req = createMockRequest('/api/workouts/split', {
      method: 'POST',
      body: { workoutId: 1, run1Distance: 11000, run2Distance: 10000 },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.workouts).toHaveLength(2)
    expect(body.workouts[0].session_order).toBe(1)
    expect(body.workouts[1].session_order).toBe(2)
  })
})
