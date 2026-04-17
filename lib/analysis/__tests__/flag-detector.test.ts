import { describe, it, expect, vi, beforeEach } from 'vitest'
import { format } from 'date-fns'

// ---------------------------------------------------------------------------
// Mock Supabase client and observation-manager
// Factory must not reference outer const variables (hoisting rule)
// ---------------------------------------------------------------------------

const mockFrom = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({ from: mockFrom })),
}))

vi.mock('../observation-manager', () => ({
  createObservation: vi.fn(),
}))

import { detectWorkoutFlags } from '../flag-detector'
import { createObservation } from '../observation-manager'

const mockCreateObservation = vi.mocked(createObservation)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryMock(data: any, error: any = null) {
  const result = { data, error }
  const mock: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
  }
  mock.then = (onfulfilled: any, onrejected?: any) =>
    Promise.resolve(result).then(onfulfilled, onrejected)
  return mock
}

function setupNoFlags() {
  mockFrom
    .mockReturnValueOnce(makeQueryMock([]))   // missed workouts → none
    .mockReturnValueOnce(makeQueryMock(null)) // weekly_plans → none
    .mockReturnValueOnce(makeQueryMock([]))   // health_metrics → empty
    .mockReturnValueOnce(makeQueryMock([]))   // activities (consistency) → empty
    .mockReturnValueOnce(makeQueryMock([]))   // activities (pace) → empty
}

function today() { return format(new Date(), 'yyyy-MM-dd') }

function observationFor(type: string, severity: string, message: string) {
  return { id: `obs-${type}`, type, severity: severity as 'info' | 'warning' | 'concern', message, created_at: new Date().toISOString(), acknowledged: false, dismissed: false }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('detectWorkoutFlags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateObservation.mockImplementation((_athleteId, type, severity, message) =>
      Promise.resolve(observationFor(type, severity, message))
    )
  })

  // -------------------------------------------------------------------------
  // All clear
  // -------------------------------------------------------------------------

  it('returns empty array when all metrics are normal', async () => {
    setupNoFlags()
    const result = await detectWorkoutFlags('athlete-1')
    expect(result).toHaveLength(0)
    expect(mockCreateObservation).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Missed workouts
  // -------------------------------------------------------------------------

  it('creates warning flag for 1 missed workout in last 7 days', async () => {
    mockFrom
      .mockReturnValueOnce(makeQueryMock([{ scheduled_date: today() }]))
      .mockReturnValueOnce(makeQueryMock(null))
      .mockReturnValueOnce(makeQueryMock([]))
      .mockReturnValueOnce(makeQueryMock([]))
      .mockReturnValueOnce(makeQueryMock([]))

    const result = await detectWorkoutFlags('athlete-1')
    expect(result).toHaveLength(1)
    const call = mockCreateObservation.mock.calls[0]
    expect(call[1]).toBe('missed_workouts')
    expect(call[2]).toBe('warning')
  })

  it('creates concern flag for 3+ missed workouts in last 7 days', async () => {
    mockFrom
      .mockReturnValueOnce(makeQueryMock([
        { scheduled_date: today() },
        { scheduled_date: today() },
        { scheduled_date: today() },
      ]))
      .mockReturnValueOnce(makeQueryMock(null))
      .mockReturnValueOnce(makeQueryMock([]))
      .mockReturnValueOnce(makeQueryMock([]))
      .mockReturnValueOnce(makeQueryMock([]))

    await detectWorkoutFlags('athlete-1')
    const call = mockCreateObservation.mock.calls[0]
    expect(call[2]).toBe('concern')
  })

  it('does not create missed-workout flag when none missed', async () => {
    setupNoFlags()
    await detectWorkoutFlags('athlete-1')
    expect(mockCreateObservation).not.toHaveBeenCalledWith(
      expect.anything(), 'missed_workouts', expect.anything(), expect.anything(), expect.anything()
    )
  })

  // -------------------------------------------------------------------------
  // Volume gap
  // -------------------------------------------------------------------------

  it('creates warning for 30-50% volume gap', async () => {
    // planned=50, actual=34km → gap=16, 16/50=32% > 30% → warning
    mockFrom
      .mockReturnValueOnce(makeQueryMock([]))
      .mockReturnValueOnce(makeQueryMock({ week_start_date: today(), weekly_volume_target: 50 }))
      .mockReturnValueOnce(makeQueryMock([{ distance_meters: 34000 }]))
      .mockReturnValueOnce(makeQueryMock([]))
      .mockReturnValueOnce(makeQueryMock([]))
      .mockReturnValueOnce(makeQueryMock([]))

    await detectWorkoutFlags('athlete-1')
    const volumeCall = mockCreateObservation.mock.calls.find(c => c[1] === 'volume_gap')
    expect(volumeCall).toBeDefined()
    expect(volumeCall![2]).toBe('warning')
  })

  it('creates concern for >50% volume gap', async () => {
    // planned=50, actual=20km → gap=30, 30/50=60% > 50% → concern
    mockFrom
      .mockReturnValueOnce(makeQueryMock([]))
      .mockReturnValueOnce(makeQueryMock({ week_start_date: today(), weekly_volume_target: 50 }))
      .mockReturnValueOnce(makeQueryMock([{ distance_meters: 20000 }]))
      .mockReturnValueOnce(makeQueryMock([]))
      .mockReturnValueOnce(makeQueryMock([]))
      .mockReturnValueOnce(makeQueryMock([]))

    await detectWorkoutFlags('athlete-1')
    const volumeCall = mockCreateObservation.mock.calls.find(c => c[1] === 'volume_gap')
    expect(volumeCall![2]).toBe('concern')
  })

  it('does not create volume-gap flag when actual is >70% of planned', async () => {
    // planned=50, actual=40km → gap=10, 10/50=20% < 30%
    mockFrom
      .mockReturnValueOnce(makeQueryMock([]))
      .mockReturnValueOnce(makeQueryMock({ week_start_date: today(), weekly_volume_target: 50 }))
      .mockReturnValueOnce(makeQueryMock([{ distance_meters: 40000 }]))
      .mockReturnValueOnce(makeQueryMock([]))
      .mockReturnValueOnce(makeQueryMock([]))
      .mockReturnValueOnce(makeQueryMock([]))

    await detectWorkoutFlags('athlete-1')
    expect(mockCreateObservation).not.toHaveBeenCalledWith(
      expect.anything(), 'volume_gap', expect.anything(), expect.anything(), expect.anything()
    )
  })

  it('does not create volume-gap flag when no weekly plan found', async () => {
    mockFrom
      .mockReturnValueOnce(makeQueryMock([]))
      .mockReturnValueOnce(makeQueryMock(null))
      .mockReturnValueOnce(makeQueryMock([]))
      .mockReturnValueOnce(makeQueryMock([]))
      .mockReturnValueOnce(makeQueryMock([]))

    await detectWorkoutFlags('athlete-1')
    expect(mockCreateObservation).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // HRV / resting HR (fatigue)
  // -------------------------------------------------------------------------

  it('creates concern flag when HRV is >15% below 7-day average', async () => {
    // avg HRV=60, recent=48 → 48/60=0.8 < 0.85 → concern
    const healthData = [
      { hrv: 48, resting_hr: 50 },
      { hrv: 62, resting_hr: 50 },
      { hrv: 63, resting_hr: 50 },
      { hrv: 67, resting_hr: 50 },
    ]
    mockFrom
      .mockReturnValueOnce(makeQueryMock([]))
      .mockReturnValueOnce(makeQueryMock(null))
      .mockReturnValueOnce(makeQueryMock(healthData))
      .mockReturnValueOnce(makeQueryMock([]))
      .mockReturnValueOnce(makeQueryMock([]))

    await detectWorkoutFlags('athlete-1')
    const hrvCall = mockCreateObservation.mock.calls.find(c => c[1] === 'hrv_low')
    expect(hrvCall).toBeDefined()
    expect(hrvCall![2]).toBe('concern')
  })

  it('does not create HRV flag when HRV is within 15% of average', async () => {
    // avg≈60, recent=58 → 58/60=0.97 > 0.85 → no flag
    const healthData = [
      { hrv: 58, resting_hr: 50 },
      { hrv: 60, resting_hr: 50 },
      { hrv: 62, resting_hr: 50 },
      { hrv: 60, resting_hr: 50 },
    ]
    mockFrom
      .mockReturnValueOnce(makeQueryMock([]))
      .mockReturnValueOnce(makeQueryMock(null))
      .mockReturnValueOnce(makeQueryMock(healthData))
      .mockReturnValueOnce(makeQueryMock([]))
      .mockReturnValueOnce(makeQueryMock([]))

    await detectWorkoutFlags('athlete-1')
    expect(mockCreateObservation).not.toHaveBeenCalledWith(
      expect.anything(), 'hrv_low', expect.anything(), expect.anything(), expect.anything()
    )
  })

  it('creates warning flag when resting HR is >10% above average', async () => {
    // avg resting_hr = (56+48+48+48)/4 = 50, recent=56 → 56/50=1.12 > 1.1 → warning
    const healthData = [
      { hrv: 60, resting_hr: 56 },  // most recent — elevated
      { hrv: 60, resting_hr: 48 },
      { hrv: 60, resting_hr: 48 },
      { hrv: 60, resting_hr: 48 },
    ]
    mockFrom
      .mockReturnValueOnce(makeQueryMock([]))
      .mockReturnValueOnce(makeQueryMock(null))
      .mockReturnValueOnce(makeQueryMock(healthData))
      .mockReturnValueOnce(makeQueryMock([]))
      .mockReturnValueOnce(makeQueryMock([]))

    await detectWorkoutFlags('athlete-1')
    const hrCall = mockCreateObservation.mock.calls.find(c => c[1] === 'resting_hr_elevated')
    expect(hrCall).toBeDefined()
    expect(hrCall![2]).toBe('warning')
  })

  it('does not check fatigue when fewer than 4 health data points', async () => {
    const healthData = [
      { hrv: 40, resting_hr: 60 },
      { hrv: 60, resting_hr: 50 },
      { hrv: 60, resting_hr: 50 },
    ]
    mockFrom
      .mockReturnValueOnce(makeQueryMock([]))
      .mockReturnValueOnce(makeQueryMock(null))
      .mockReturnValueOnce(makeQueryMock(healthData))
      .mockReturnValueOnce(makeQueryMock([]))
      .mockReturnValueOnce(makeQueryMock([]))

    await detectWorkoutFlags('athlete-1')
    expect(mockCreateObservation).not.toHaveBeenCalledWith(
      expect.anything(), 'hrv_low', expect.anything(), expect.anything(), expect.anything()
    )
  })

  // -------------------------------------------------------------------------
  // Training gap (consistency)
  // -------------------------------------------------------------------------

  it('creates warning flag for 10-day training gap', async () => {
    const dates = [
      new Date('2026-03-01').toISOString(),
      new Date('2026-03-11').toISOString(),  // 10-day gap
      new Date('2026-03-12').toISOString(),
    ]
    mockFrom
      .mockReturnValueOnce(makeQueryMock([]))
      .mockReturnValueOnce(makeQueryMock(null))
      .mockReturnValueOnce(makeQueryMock([]))
      .mockReturnValueOnce(makeQueryMock(dates.map(d => ({ start_time: d }))))
      .mockReturnValueOnce(makeQueryMock([]))

    await detectWorkoutFlags('athlete-1')
    const gapCall = mockCreateObservation.mock.calls.find(c => c[1] === 'training_gap')
    expect(gapCall).toBeDefined()
    expect(gapCall![2]).toBe('warning')
  })

  it('creates concern flag for >14-day training gap', async () => {
    const dates = [
      new Date('2026-03-01').toISOString(),
      new Date('2026-03-20').toISOString(),  // 19-day gap
    ]
    mockFrom
      .mockReturnValueOnce(makeQueryMock([]))
      .mockReturnValueOnce(makeQueryMock(null))
      .mockReturnValueOnce(makeQueryMock([]))
      .mockReturnValueOnce(makeQueryMock(dates.map(d => ({ start_time: d }))))
      .mockReturnValueOnce(makeQueryMock([]))

    await detectWorkoutFlags('athlete-1')
    const gapCall = mockCreateObservation.mock.calls.find(c => c[1] === 'training_gap')
    expect(gapCall![2]).toBe('concern')
  })

  it('does not create gap flag when max gap is <= 7 days', async () => {
    const dates = [
      new Date('2026-03-15').toISOString(),
      new Date('2026-03-20').toISOString(),  // 5-day gap
      new Date('2026-03-22').toISOString(),
    ]
    mockFrom
      .mockReturnValueOnce(makeQueryMock([]))
      .mockReturnValueOnce(makeQueryMock(null))
      .mockReturnValueOnce(makeQueryMock([]))
      .mockReturnValueOnce(makeQueryMock(dates.map(d => ({ start_time: d }))))
      .mockReturnValueOnce(makeQueryMock([]))

    await detectWorkoutFlags('athlete-1')
    expect(mockCreateObservation).not.toHaveBeenCalledWith(
      expect.anything(), 'training_gap', expect.anything(), expect.anything(), expect.anything()
    )
  })

  // -------------------------------------------------------------------------
  // Pace decline
  // -------------------------------------------------------------------------

  it('creates info flag when recent pace is >5% slower than prior average', async () => {
    // recent (first 3): 6:00/km = 360 s/km
    // older (3-6): 5:42/km = 342 s/km
    // 360/342 ≈ 1.053 > 1.05 → pace_decline info
    const runs = [
      { distance_meters: 10000, duration_seconds: 3600, start_time: '2026-03-28T08:00:00Z' },
      { distance_meters: 10000, duration_seconds: 3600, start_time: '2026-03-27T08:00:00Z' },
      { distance_meters: 10000, duration_seconds: 3600, start_time: '2026-03-26T08:00:00Z' },
      { distance_meters: 10000, duration_seconds: 3420, start_time: '2026-03-20T08:00:00Z' },
      { distance_meters: 10000, duration_seconds: 3420, start_time: '2026-03-18T08:00:00Z' },
      { distance_meters: 10000, duration_seconds: 3420, start_time: '2026-03-15T08:00:00Z' },
    ]
    mockFrom
      .mockReturnValueOnce(makeQueryMock([]))
      .mockReturnValueOnce(makeQueryMock(null))
      .mockReturnValueOnce(makeQueryMock([]))
      .mockReturnValueOnce(makeQueryMock([]))
      .mockReturnValueOnce(makeQueryMock(runs))

    await detectWorkoutFlags('athlete-1')
    const paceCall = mockCreateObservation.mock.calls.find(c => c[1] === 'pace_decline')
    expect(paceCall).toBeDefined()
    expect(paceCall![2]).toBe('info')
  })

  it('does not create pace flag when fewer than 5 recent runs', async () => {
    const runs = [
      { distance_meters: 10000, duration_seconds: 4000, start_time: '2026-03-28T08:00:00Z' },
      { distance_meters: 10000, duration_seconds: 3400, start_time: '2026-03-20T08:00:00Z' },
    ]
    mockFrom
      .mockReturnValueOnce(makeQueryMock([]))
      .mockReturnValueOnce(makeQueryMock(null))
      .mockReturnValueOnce(makeQueryMock([]))
      .mockReturnValueOnce(makeQueryMock([]))
      .mockReturnValueOnce(makeQueryMock(runs))

    await detectWorkoutFlags('athlete-1')
    expect(mockCreateObservation).not.toHaveBeenCalledWith(
      expect.anything(), 'pace_decline', expect.anything(), expect.anything(), expect.anything()
    )
  })
})
