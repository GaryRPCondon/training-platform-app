import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DeepSeekProvider } from '@/lib/agent/providers/deepseek'

function mockFetchOnce() {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    }),
  }))
  vi.stubGlobal('fetch', fetchMock as any)
  return fetchMock
}

function lastBody(fetchMock: ReturnType<typeof mockFetchOnce>): any {
  const call = fetchMock.mock.calls.at(-1) as any[]
  return JSON.parse(call[1].body)
}

describe('DeepSeekProvider', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.unstubAllGlobals())

  it('defaults to the current deepseek-v4-flash model id (not the retired deepseek-chat)', async () => {
    const fetchMock = mockFetchOnce()
    const provider = new DeepSeekProvider('key')
    await provider.generateResponse({ messages: [{ role: 'user', content: 'hi' }] })
    expect(lastBody(fetchMock).model).toBe('deepseek-v4-flash')
  })

  it('sends thinking:disabled when disableThinking is true', async () => {
    const fetchMock = mockFetchOnce()
    const provider = new DeepSeekProvider('key')
    await provider.generateResponse({
      messages: [{ role: 'user', content: 'hi' }],
      disableThinking: true,
    })
    expect(lastBody(fetchMock).thinking).toEqual({ type: 'disabled' })
  })

  it('sends thinking:enabled when disableThinking is false', async () => {
    const fetchMock = mockFetchOnce()
    const provider = new DeepSeekProvider('key')
    await provider.generateResponse({
      messages: [{ role: 'user', content: 'hi' }],
      disableThinking: false,
    })
    expect(lastBody(fetchMock).thinking).toEqual({ type: 'enabled' })
  })

  it('omits the thinking param when unset (uses model default)', async () => {
    const fetchMock = mockFetchOnce()
    const provider = new DeepSeekProvider('key')
    await provider.generateResponse({ messages: [{ role: 'user', content: 'hi' }] })
    expect(lastBody(fetchMock)).not.toHaveProperty('thinking')
  })
})
