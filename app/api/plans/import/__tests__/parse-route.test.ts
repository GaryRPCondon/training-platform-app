import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockRequest, makeMockSupabase } from '@/lib/__tests__/helpers/api-test-utils'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/plans/import/parser', () => ({
  parseRunningPlan: vi.fn(),
  // Re-create the error class so the route's `instanceof` checks still work.
  RunPlanParseError: class RunPlanParseError extends Error {
    details: Record<string, unknown>
    constructor(message: string, details: Record<string, unknown>) {
      super(message)
      this.name = 'RunPlanParseError'
      this.details = details
    }
  },
}))

import { createClient } from '@/lib/supabase/server'
import { parseRunningPlan, RunPlanParseError } from '@/lib/plans/import/parser'
import { POST } from '../parse/route'

const mockCreateClient = vi.mocked(createClient)
const mockParse = vi.mocked(parseRunningPlan)

function req(body: unknown) {
  return createMockRequest('/api/plans/import/parse', { method: 'POST', body })
}

describe('POST /api/plans/import/parse', () => {
  beforeEach(() => vi.clearAllMocks())

  it('400 on invalid body', async () => {
    mockCreateClient.mockResolvedValue(makeMockSupabase({ id: 'u1' }) as any)
    const res = await POST(req({ source_type: 'free_text' })) // missing text
    expect(res.status).toBe(400)
  })

  it('200 for image source — routes through the vision path', async () => {
    mockCreateClient.mockResolvedValue(makeMockSupabase({ id: 'u1' }) as any)
    mockParse.mockResolvedValue({
      plan: { schema_version: '1.0', name: 'P', weeks: [], parse_warnings: [] } as any,
      confidence: 0.8, contentType: 'running', warnings: [], totalWeeks: 12,
      model: 'vision-model', inputTokens: 5, outputTokens: 5,
    })
    const res = await POST(req({ source_type: 'image', images: [{ mimeType: 'image/png', dataBase64: 'x' }] }))
    expect(res.status).toBe(200)
    expect(mockParse).toHaveBeenCalledWith(expect.objectContaining({ source_type: 'image' }))
  })

  it('401 when unauthenticated', async () => {
    mockCreateClient.mockResolvedValue(makeMockSupabase(null) as any)
    const res = await POST(req({ source_type: 'free_text', text: 'Week 1 ...' }))
    expect(res.status).toBe(401)
  })

  it('200 returns parsed plan on success', async () => {
    mockCreateClient.mockResolvedValue(makeMockSupabase({ id: 'u1' }) as any)
    mockParse.mockResolvedValue({
      plan: { schema_version: '1.0', name: 'P', weeks: [], parse_warnings: [] } as any,
      confidence: 0.9,
      contentType: 'running',
      warnings: [],
      totalWeeks: 16,
      model: 'test-model',
      inputTokens: 10,
      outputTokens: 20,
    })
    const res = await POST(req({ source_type: 'free_text', text: 'Week 1 / Mon: Easy 8k' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.totalWeeks).toBe(16)
    expect(body.confidence).toBe(0.9)
    expect(mockParse).toHaveBeenCalledOnce()
  })

  it('422 when the parser rejects the input', async () => {
    mockCreateClient.mockResolvedValue(makeMockSupabase({ id: 'u1' }) as any)
    mockParse.mockRejectedValue(new RunPlanParseError('bad json', { responseText: 'x' }))
    const res = await POST(req({ source_type: 'free_text', text: 'garbage' }))
    expect(res.status).toBe(422)
  })
})
