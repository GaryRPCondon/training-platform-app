import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resolveVisionModel, VisionUnavailableError } from '../vision'

const ENV_KEYS = [
  'IMPORT_VISION_PROVIDER',
  'IMPORT_VISION_MODEL',
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
]

describe('resolveVisionModel', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
  })
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('uses an explicit per-user selection (provider + model) above everything', () => {
    process.env.GEMINI_API_KEY = 'x'
    process.env.IMPORT_VISION_PROVIDER = 'openai'
    process.env.IMPORT_VISION_MODEL = 'gpt-4o'
    expect(resolveVisionModel({ provider: 'anthropic', model: 'claude-opus-4-8' }))
      .toEqual({ provider: 'anthropic', model: 'claude-opus-4-8' })
  })

  it('fills in the provider default model when the user leaves the model blank', () => {
    expect(resolveVisionModel({ provider: 'gemini' }))
      .toEqual({ provider: 'gemini', model: 'gemini-2.5-flash' })
    expect(resolveVisionModel({ provider: 'openai' }))
      .toEqual({ provider: 'openai', model: 'gpt-4o' })
  })

  it('throws when a per-user provider has no known default and no model', () => {
    expect(() => resolveVisionModel({ provider: 'mystery' })).toThrow(VisionUnavailableError)
  })

  it('uses the explicit env override when both provider and model are set', () => {
    process.env.IMPORT_VISION_PROVIDER = 'openai'
    process.env.IMPORT_VISION_MODEL = 'gpt-4o-mini'
    expect(resolveVisionModel()).toEqual({ provider: 'openai', model: 'gpt-4o-mini' })
  })

  it('defaults to Gemini Flash when GEMINI_API_KEY is present', () => {
    process.env.GEMINI_API_KEY = 'x'
    process.env.OPENAI_API_KEY = 'x'
    expect(resolveVisionModel()).toEqual({ provider: 'gemini', model: 'gemini-2.5-flash' })
  })

  it('falls back to OpenAI then Anthropic by key availability', () => {
    process.env.OPENAI_API_KEY = 'x'
    expect(resolveVisionModel()).toEqual({ provider: 'openai', model: 'gpt-4o' })

    delete process.env.OPENAI_API_KEY
    process.env.ANTHROPIC_API_KEY = 'x'
    expect(resolveVisionModel()).toEqual({ provider: 'anthropic', model: 'claude-opus-4-8' })
  })

  it('throws VisionUnavailableError when no vision key is configured', () => {
    expect(() => resolveVisionModel()).toThrow(VisionUnavailableError)
  })

  it('does not route to the general provider (e.g. DeepSeek) for vision', () => {
    // Only a DeepSeek key present → DeepSeek can't do vision, so this must throw.
    process.env.DEEPSEEK_API_KEY = 'x'
    expect(() => resolveVisionModel()).toThrow(VisionUnavailableError)
    delete process.env.DEEPSEEK_API_KEY
  })
})
