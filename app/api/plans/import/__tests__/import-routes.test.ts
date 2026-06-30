import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockRequest, makeMockSupabase } from '@/lib/__tests__/helpers/api-test-utils'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { POST as ACCEPT, GET as LIST } from '../route'
import { DELETE, GET as GET_ONE } from '../[id]/route'
import { POST as GENERATE } from '../[id]/generate/route'

const mockCreateClient = vi.mocked(createClient)

const validDefinition = {
  schema_version: '1.0',
  name: 'Test Plan',
  weeks: [
    { week_index: 1, workouts: [{ day_of_week: 1, type: 'easy_run', description: 'Easy 8 km', distance_meters: 8000, intensity: 'easy' }] },
  ],
  parse_warnings: [],
}

const validAcceptBody = {
  name: 'Test Plan',
  source_type: 'free_text',
  definition: validDefinition,
}

const validGenBody = {
  goal_name: 'Spring Marathon',
  start_date: '2026-01-05',
  goal_date: '2026-04-19',
  goal_type: 'marathon',
  current_weekly_mileage: 40,
  comfortable_peak_mileage: 65,
  days_per_week: 5,
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) }
}

describe('POST /api/plans/import (accept — definition only)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('401 when unauthenticated', async () => {
    mockCreateClient.mockResolvedValue(makeMockSupabase(null) as any)
    const res = await ACCEPT(createMockRequest('/api/plans/import', { method: 'POST', body: validAcceptBody }))
    expect(res.status).toBe(401)
  })

  it('400 on invalid body', async () => {
    mockCreateClient.mockResolvedValue(makeMockSupabase({ id: 'u1' }) as any)
    const res = await ACCEPT(createMockRequest('/api/plans/import', { method: 'POST', body: { name: 'x' } }))
    expect(res.status).toBe(400)
  })

  it('201 persists the definition (no race fields required)', async () => {
    const chain: any = {
      insert: () => chain, select: () => chain,
      single: () => Promise.resolve({ data: { id: 42 }, error: null }),
    }
    mockCreateClient.mockResolvedValue(makeMockSupabase({ id: 'u1' }, () => chain) as any)
    const res = await ACCEPT(createMockRequest('/api/plans/import', { method: 'POST', body: validAcceptBody }))
    expect(res.status).toBe(201)
    expect((await res.json()).importedRunPlanId).toBe(42)
  })
})

describe('GET /api/plans/import (list)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('401 when unauthenticated', async () => {
    mockCreateClient.mockResolvedValue(makeMockSupabase(null) as any)
    expect((await LIST()).status).toBe(401)
  })
})

describe('GET/DELETE /api/plans/import/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('400 on non-numeric id', async () => {
    mockCreateClient.mockResolvedValue(makeMockSupabase({ id: 'u1' }) as any)
    expect((await GET_ONE(createMockRequest('/x'), ctx('abc'))).status).toBe(400)
    expect((await DELETE(createMockRequest('/x', { method: 'DELETE' }), ctx('abc'))).status).toBe(400)
  })

  it('401 when unauthenticated', async () => {
    mockCreateClient.mockResolvedValue(makeMockSupabase(null) as any)
    expect((await GET_ONE(createMockRequest('/x'), ctx('1'))).status).toBe(401)
  })

  it('404 when the imported plan is not found', async () => {
    const chain: any = {
      select: () => chain, eq: () => chain, update: () => chain,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
    }
    mockCreateClient.mockResolvedValue(makeMockSupabase({ id: 'u1' }, () => chain) as any)
    const res = await DELETE(createMockRequest('/x', { method: 'DELETE' }), ctx('1'))
    expect(res.status).toBe(404)
  })
})

describe('POST /api/plans/import/[id]/generate (schedule, LLM-tailored)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('400 on non-numeric id', async () => {
    mockCreateClient.mockResolvedValue(makeMockSupabase({ id: 'u1' }) as any)
    const res = await GENERATE(createMockRequest('/x', { method: 'POST', body: validGenBody }), ctx('abc'))
    expect(res.status).toBe(400)
  })

  it('400 when goal_date not after start_date', async () => {
    mockCreateClient.mockResolvedValue(makeMockSupabase({ id: 'u1' }) as any)
    const res = await GENERATE(
      createMockRequest('/x', { method: 'POST', body: { ...validGenBody, goal_date: '2026-01-05' } }),
      ctx('1'),
    )
    expect(res.status).toBe(400)
  })

  it('400 on invalid body', async () => {
    mockCreateClient.mockResolvedValue(makeMockSupabase({ id: 'u1' }) as any)
    const res = await GENERATE(createMockRequest('/x', { method: 'POST', body: { goal_name: 'x' } }), ctx('1'))
    expect(res.status).toBe(400)
  })

  it('401 when unauthenticated', async () => {
    mockCreateClient.mockResolvedValue(makeMockSupabase(null) as any)
    const res = await GENERATE(createMockRequest('/x', { method: 'POST', body: validGenBody }), ctx('1'))
    expect(res.status).toBe(401)
  })

  it('404 when the imported plan is not found', async () => {
    const chain: any = {
      select: () => chain, eq: () => chain,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
    }
    mockCreateClient.mockResolvedValue(makeMockSupabase({ id: 'u1' }, () => chain) as any)
    const res = await GENERATE(createMockRequest('/x', { method: 'POST', body: validGenBody }), ctx('1'))
    expect(res.status).toBe(404)
  })
})
