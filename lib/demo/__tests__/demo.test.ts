import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  isDemoUser,
  demoProviderOverride,
  isDemoRestrictedPath,
  DEMO_LLM_PROVIDER,
} from '@/lib/demo/demo'

const DEMO_ID = '00000000-0000-0000-0000-000000000demo'
const OTHER_ID = '11111111-1111-1111-1111-111111111111'

describe('isDemoUser', () => {
  const original = process.env.DEMO_USER_ID
  afterEach(() => {
    if (original === undefined) delete process.env.DEMO_USER_ID
    else process.env.DEMO_USER_ID = original
  })

  it('is true only for the pinned demo id', () => {
    process.env.DEMO_USER_ID = DEMO_ID
    expect(isDemoUser(DEMO_ID)).toBe(true)
    expect(isDemoUser(OTHER_ID)).toBe(false)
  })

  it('is false for null/undefined ids', () => {
    process.env.DEMO_USER_ID = DEMO_ID
    expect(isDemoUser(null)).toBe(false)
    expect(isDemoUser(undefined)).toBe(false)
  })

  it('is false for everyone when DEMO_USER_ID is unset (demo not provisioned)', () => {
    delete process.env.DEMO_USER_ID
    expect(isDemoUser(DEMO_ID)).toBe(false)
    expect(isDemoUser(OTHER_ID)).toBe(false)
  })
})

describe('demoProviderOverride', () => {
  const original = process.env.DEMO_USER_ID
  beforeEach(() => {
    process.env.DEMO_USER_ID = DEMO_ID
  })
  afterEach(() => {
    if (original === undefined) delete process.env.DEMO_USER_ID
    else process.env.DEMO_USER_ID = original
  })

  it('pins the cheap provider with no model for the demo user', () => {
    expect(demoProviderOverride(DEMO_ID)).toEqual({ providerName: DEMO_LLM_PROVIDER, modelName: undefined })
  })

  it('returns null for non-demo users so the caller keeps stored preferences', () => {
    expect(demoProviderOverride(OTHER_ID)).toBeNull()
    expect(demoProviderOverride(null)).toBeNull()
  })
})

describe('isDemoRestrictedPath', () => {
  it('blocks exact restricted routes', () => {
    expect(isDemoRestrictedPath('/api/plans/import/parse', 'POST')).toBe(true)
    expect(isDemoRestrictedPath('/api/strength/parse', 'POST')).toBe(true)
    expect(isDemoRestrictedPath('/api/strength/schedule', 'POST')).toBe(true)
    expect(isDemoRestrictedPath('/api/strava/auth', 'GET')).toBe(true)
    expect(isDemoRestrictedPath('/api/garmin/workouts', 'POST')).toBe(true)
    expect(isDemoRestrictedPath('/api/garmin/strength-workouts', 'POST')).toBe(true)
    expect(isDemoRestrictedPath('/api/auth/create-athlete', 'POST')).toBe(true)
  })

  it('blocks everything beneath the plan-import prefix', () => {
    expect(isDemoRestrictedPath('/api/plans/import/42/generate', 'POST')).toBe(true)
    expect(isDemoRestrictedPath('/api/plans/import/anything', 'GET')).toBe(true)
  })

  it('does not proxy-block settings — the update route self-guards (allows safe prefs, strips the rest)', () => {
    expect(isDemoRestrictedPath('/api/settings/update', 'POST')).toBe(false)
    expect(isDemoRestrictedPath('/api/settings', 'GET')).toBe(false)
  })

  it('allows unrelated routes (chat, plan generation)', () => {
    expect(isDemoRestrictedPath('/api/agent/chat', 'POST')).toBe(false)
    expect(isDemoRestrictedPath('/api/plans/generate', 'POST')).toBe(false)
  })
})
