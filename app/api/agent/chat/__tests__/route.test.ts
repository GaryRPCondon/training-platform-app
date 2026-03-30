import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockRequest, makeMockSupabase } from '@/lib/__tests__/helpers/api-test-utils'

// ---------------------------------------------------------------------------
// Mocks — factory must not reference outer const variables (hoisting rule)
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/ensure-athlete', () => ({
  ensureAthleteExists: vi.fn().mockResolvedValue({ athleteId: 'athlete-1', error: null }),
}))
vi.mock('@/lib/agent/context-loader', () => ({
  loadAgentContext: vi.fn().mockResolvedValue({ summary: 'mock context' }),
}))
vi.mock('@/lib/agent/prompts', () => ({
  getSystemPrompt: vi.fn().mockReturnValue('You are an AI coach.'),
}))
vi.mock('@/lib/agent/session-manager', () => ({
  createChatSession: vi.fn().mockResolvedValue({ id: 42 }),
  getChatSession: vi.fn().mockResolvedValue({ messages: [] }),
  saveMessage: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/agent/factory', () => ({
  createLLMProvider: vi.fn().mockReturnValue({
    generateResponse: vi.fn().mockResolvedValue({
      content: 'Here is your training advice.',
      model: 'mock-model',
      usage: { input_tokens: 100, output_tokens: 50 },
    }),
  }),
}))

import { createClient } from '@/lib/supabase/server'
import { getChatSession } from '@/lib/agent/session-manager'

const mockCreateClient = vi.mocked(createClient)
const mockGetChatSession = vi.mocked(getChatSession)

import { POST } from '../route'

// ---------------------------------------------------------------------------
// Helper to build a supabase mock that returns preferred_llm_provider
// ---------------------------------------------------------------------------

function makeAthleteSupabase(user: { id: string; email?: string } | null) {
  return makeMockSupabase(
    user,
    (_table) => {
      const mock: any = {
        select: () => mock,
        eq: () => mock,
        single: () => Promise.resolve({
          data: { preferred_llm_provider: 'deepseek', preferred_llm_model: null },
          error: null,
        }),
      }
      mock.then = (fn: any) => Promise.resolve({ data: null, error: null }).then(fn)
      return mock
    }
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/agent/chat', () => {
  beforeEach(() => {
    // vi.clearAllMocks() clears call history only — implementations from vi.mock() persist
    vi.clearAllMocks()
    // Re-apply implementations that were cleared by clearAllMocks
    mockGetChatSession.mockResolvedValue({ id: 1, athlete_id: 'a1', session_type: 'general', weekly_plan_id: null, specific_workout_id: null, context: null, started_at: new Date().toISOString(), ended_at: null, title: null, messages: [] })
  })

  it('returns 401 when not authenticated', async () => {
    mockCreateClient.mockResolvedValue(makeMockSupabase(null) as any)
    const req = createMockRequest('/api/agent/chat', {
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'How is my training?' }] },
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Unauthorized')
  })

  it('returns 200 with message and sessionId for new session', async () => {
    mockCreateClient.mockResolvedValue(makeAthleteSupabase({ id: 'user-1', email: 'user@example.com' }) as any)
    const req = createMockRequest('/api/agent/chat', {
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'What should I do for my long run?' }] },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('message')
    expect(body).toHaveProperty('sessionId')
    expect(typeof body.message).toBe('string')
  })

  it('returns correct response shape', async () => {
    mockCreateClient.mockResolvedValue(makeAthleteSupabase({ id: 'user-1', email: 'user@example.com' }) as any)
    const req = createMockRequest('/api/agent/chat', {
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'How is my training?' }] },
    })
    const res = await POST(req)
    const body = await res.json()
    expect(body).toHaveProperty('message')
    expect(body).toHaveProperty('sessionId')
    expect(body).toHaveProperty('model')
    expect(body).toHaveProperty('provider')
  })

  it('uses existing sessionId when provided', async () => {
    mockGetChatSession.mockResolvedValue({
      messages: [{ role: 'user', content: 'Previous message' }],
    } as any)
    mockCreateClient.mockResolvedValue(makeAthleteSupabase({ id: 'user-1', email: 'user@example.com' }) as any)
    const req = createMockRequest('/api/agent/chat', {
      method: 'POST',
      body: {
        messages: [{ role: 'user', content: 'Follow-up question' }],
        sessionId: 99,
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sessionId).toBe(99)
  })
})
