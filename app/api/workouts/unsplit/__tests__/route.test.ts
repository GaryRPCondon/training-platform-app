import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockRequest, makeMockSupabase } from '@/lib/__tests__/helpers/api-test-utils'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

import { createClient } from '@/lib/supabase/server'
const mockCreateClient = vi.mocked(createClient)

import { POST } from '../route'

const run1 = {
  id: 2,
  athlete_id: 'user-1',
  scheduled_date: '2026-05-15',
  scheduled_time: null,
  workout_type: 'easy_run',
  workout_index: 'W1:D2',
  weekly_plan_id: 10,
  session_order: 1,
  description: 'Easy 21k (Run 1)',
  distance_target_meters: 11000,
  intensity_target: 'easy',
  notes: null,
}
const run2 = { ...run1, id: 3, session_order: 2, description: 'Easy 21k (Run 2)', distance_target_meters: 10000 }

function buildSupabase(opts: {
  fetchedRow?: any
  fetchError?: { message: string } | null
  dayRows?: any[] | null
  daysError?: { message: string } | null
  inserted?: any
  insertError?: { message: string } | null
}) {
  const {
    fetchedRow = run1,
    fetchError = null,
    dayRows = [run1, run2],
    daysError = null,
    inserted = { id: 4, session_order: 1, distance_target_meters: 21000 },
    insertError = null,
  } = opts

  let phase: 'fetch-row' | 'find-day' | 'delete' | 'insert-merged' | 'restore' = 'fetch-row'

  return makeMockSupabase({ id: 'user-1' }, () => {
    const mock: any = {
      select: () => mock,
      eq: () => mock,
      order: () => {
        if (phase === 'fetch-row') phase = 'find-day'
        return mock
      },
      delete: () => {
        phase = 'delete'
        return mock
      },
      in: () => mock,
      insert: () => {
        if (phase === 'delete') phase = 'insert-merged'
        else phase = 'restore'
        return mock
      },
      single: () => {
        if (phase === 'fetch-row') {
          return Promise.resolve({ data: fetchedRow, error: fetchError })
        }
        if (phase === 'insert-merged') {
          return Promise.resolve({ data: inserted, error: insertError })
        }
        return Promise.resolve({ data: null, error: null })
      },
    }
    mock.then = (onfulfilled: any) => {
      if (phase === 'find-day') {
        return Promise.resolve({ data: dayRows, error: daysError }).then(onfulfilled)
      }
      if (phase === 'delete') {
        return Promise.resolve({ data: null, error: null }).then(onfulfilled)
      }
      if (phase === 'restore') {
        return Promise.resolve({ data: null, error: null }).then(onfulfilled)
      }
      return Promise.resolve({ data: null, error: null }).then(onfulfilled)
    }
    return mock
  })
}

describe('POST /api/workouts/unsplit', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockCreateClient.mockResolvedValue(makeMockSupabase(null) as any)
    const req = createMockRequest('/api/workouts/unsplit', {
      method: 'POST',
      body: { workoutId: 2 },
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 404 when workout not found', async () => {
    mockCreateClient.mockResolvedValue(buildSupabase({ fetchedRow: null, fetchError: { message: 'not found' } }) as any)
    const req = createMockRequest('/api/workouts/unsplit', {
      method: 'POST',
      body: { workoutId: 99 },
    })
    const res = await POST(req)
    expect(res.status).toBe(404)
  })

  it('returns 400 when only one workout exists on the date', async () => {
    mockCreateClient.mockResolvedValue(buildSupabase({ dayRows: [run1] }) as any)
    const req = createMockRequest('/api/workouts/unsplit', {
      method: 'POST',
      body: { workoutId: 2 },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/expected exactly 2/i)
  })

  it('returns 400 when three workouts exist on the date', async () => {
    mockCreateClient.mockResolvedValue(buildSupabase({ dayRows: [run1, run2, { ...run1, id: 5, session_order: 3 }] }) as any)
    const req = createMockRequest('/api/workouts/unsplit', {
      method: 'POST',
      body: { workoutId: 2 },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('happy path returns merged workout with summed distance', async () => {
    mockCreateClient.mockResolvedValue(
      buildSupabase({
        inserted: { id: 4, session_order: 1, distance_target_meters: 21000, scheduled_date: '2026-05-15' },
      }) as any
    )
    const req = createMockRequest('/api/workouts/unsplit', {
      method: 'POST',
      body: { workoutId: 2 },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.workout.distance_target_meters).toBe(21000)
    expect(body.workout.session_order).toBe(1)
  })
})
