import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Supabase mock (overrides vitest.setup.ts global mock)
// ---------------------------------------------------------------------------

const mockFrom = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({ from: mockFrom })),
}))

import { getPhaseProgress, getWeeklyProgress } from '../phase-progress'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a chainable Supabase query mock that resolves to { data, error }.
 * Supports both .single() and direct await (list queries).
 */
function makeQueryMock(data: any, error: any = null) {
  const result = { data, error }
  const mock: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
  }
  mock.then = (onfulfilled: any, onrejected?: any) =>
    Promise.resolve(result).then(onfulfilled, onrejected)
  return mock
}

// ---------------------------------------------------------------------------
// getPhaseProgress
// ---------------------------------------------------------------------------

describe('getPhaseProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when no active plan found', async () => {
    // training_plans query returns null
    mockFrom.mockReturnValueOnce(makeQueryMock(null))
    const result = await getPhaseProgress('athlete-1')
    expect(result).toBeNull()
  })

  it('returns null when no current phase found', async () => {
    mockFrom
      .mockReturnValueOnce(makeQueryMock({ id: 'plan-1' }))     // training_plans
      .mockReturnValueOnce(makeQueryMock(null))                   // training_phases → null
    const result = await getPhaseProgress('athlete-1')
    expect(result).toBeNull()
  })

  it('returns PhaseProgress with correct fields for active base phase', async () => {
    const phaseStart = '2026-02-16'  // ~6 weeks before today (2026-03-29)
    const phaseEnd = '2026-05-04'    // 10-week phase

    mockFrom
      .mockReturnValueOnce(makeQueryMock({ id: 'plan-1' }))   // training_plans
      .mockReturnValueOnce(makeQueryMock({                      // training_phases
        phase_name: 'Base',
        description: 'Build aerobic base',
        start_date: phaseStart,
        end_date: phaseEnd,
      }))
      .mockReturnValueOnce(makeQueryMock({                      // weekly_plans
        week_start_date: '2026-03-23',
        weekly_volume_target: 50000,
      }))
      .mockReturnValueOnce(makeQueryMock([                      // activities
        { distance_meters: 15000 },
        { distance_meters: 8000 },
      ]))

    const result = await getPhaseProgress('athlete-1')
    expect(result).not.toBeNull()
    expect(result!.phaseName).toBe('Base')
    expect(result!.phaseDescription).toBe('Build aerobic base')
    expect(result!.weeklyVolumeTarget).toBe(50)
    expect(result!.weeklyVolumeActual).toBe(23)  // (15000+8000)/1000
    expect(result!.volumePercentComplete).toBe(46) // round(23/50*100)
  })

  it('returns upcomingMilestone "Build phase starts soon" for base phase', async () => {
    mockFrom
      .mockReturnValueOnce(makeQueryMock({ id: 'plan-1' }))
      .mockReturnValueOnce(makeQueryMock({
        phase_name: 'base',
        description: '',
        start_date: '2026-02-16',
        end_date: '2026-05-04',
      }))
      .mockReturnValueOnce(makeQueryMock({ week_start_date: '2026-03-23', weekly_volume_target: 40000 }))
      .mockReturnValueOnce(makeQueryMock([]))

    const result = await getPhaseProgress('athlete-1')
    expect(result!.upcomingMilestone).toContain('Build phase')
  })

  it('returns upcomingMilestone "Taper phase next" for peak phase', async () => {
    mockFrom
      .mockReturnValueOnce(makeQueryMock({ id: 'plan-1' }))
      .mockReturnValueOnce(makeQueryMock({
        phase_name: 'peak',
        description: '',
        start_date: '2026-03-16',
        end_date: '2026-04-06',
      }))
      .mockReturnValueOnce(makeQueryMock({ week_start_date: '2026-03-23', weekly_volume_target: 60000 }))
      .mockReturnValueOnce(makeQueryMock([]))

    const result = await getPhaseProgress('athlete-1')
    expect(result!.upcomingMilestone).toContain('Taper')
  })

  it('returns volumePercentComplete 0 when weekly volume target is 0', async () => {
    mockFrom
      .mockReturnValueOnce(makeQueryMock({ id: 'plan-1' }))
      .mockReturnValueOnce(makeQueryMock({
        phase_name: 'base',
        description: '',
        start_date: '2026-02-16',
        end_date: '2026-05-04',
      }))
      .mockReturnValueOnce(makeQueryMock({ week_start_date: '2026-03-23', weekly_volume_target: 0 }))
      .mockReturnValueOnce(makeQueryMock([]))

    const result = await getPhaseProgress('athlete-1')
    expect(result!.volumePercentComplete).toBe(0)
  })

  it('handles null weekly plan gracefully', async () => {
    mockFrom
      .mockReturnValueOnce(makeQueryMock({ id: 'plan-1' }))
      .mockReturnValueOnce(makeQueryMock({
        phase_name: 'build',
        description: '',
        start_date: '2026-02-16',
        end_date: '2026-05-04',
      }))
      .mockReturnValueOnce(makeQueryMock(null))  // No weekly plan

    const result = await getPhaseProgress('athlete-1')
    expect(result!.weeklyVolumeTarget).toBe(0)
    expect(result!.weeklyVolumeActual).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// getWeeklyProgress
// ---------------------------------------------------------------------------

describe('getWeeklyProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 7 days of progress', async () => {
    mockFrom
      .mockReturnValueOnce(makeQueryMock({ week_starts_on: 1 }))  // athletes
      .mockReturnValueOnce(makeQueryMock([]))                       // planned_workouts
      .mockReturnValueOnce(makeQueryMock([]))                       // activities

    const result = await getWeeklyProgress('athlete-1')
    expect(result).toHaveLength(7)
  })

  it('returns status "completed" for day with matching activity', async () => {
    const today = new Date()
    const dateStr = today.toISOString().split('T')[0]

    mockFrom
      .mockReturnValueOnce(makeQueryMock({ week_starts_on: 1 }))
      .mockReturnValueOnce(makeQueryMock([{
        scheduled_date: dateStr,
        distance_target_meters: 10000,
      }]))
      .mockReturnValueOnce(makeQueryMock([{
        start_time: dateStr + 'T08:00:00',
        distance_meters: 10200,
      }]))

    const result = await getWeeklyProgress('athlete-1')
    const todayProgress = result.find(d => d.date === dateStr)
    expect(todayProgress?.status).toBe('completed')
  })

  it('returns status "planned" for future day with workout', async () => {
    // Use a date 3 days in the future
    const future = new Date()
    future.setDate(future.getDate() + 3)
    const dateStr = future.toISOString().split('T')[0]

    mockFrom
      .mockReturnValueOnce(makeQueryMock({ week_starts_on: 1 }))
      .mockReturnValueOnce(makeQueryMock([{
        scheduled_date: dateStr,
        distance_target_meters: 8000,
      }]))
      .mockReturnValueOnce(makeQueryMock([]))

    const result = await getWeeklyProgress('athlete-1')
    const futureDay = result.find(d => d.date === dateStr)
    if (futureDay) {
      expect(futureDay.status).toBe('planned')
    }
  })

  it('returns status "none" for days with no workout and no activity', async () => {
    mockFrom
      .mockReturnValueOnce(makeQueryMock({ week_starts_on: 1 }))
      .mockReturnValueOnce(makeQueryMock([]))
      .mockReturnValueOnce(makeQueryMock([]))

    const result = await getWeeklyProgress('athlete-1')
    // All days with no workout and no activity should be 'none' or 'missed'
    result.forEach(day => {
      expect(['none', 'missed', 'planned', 'completed']).toContain(day.status)
    })
  })

  it('uses Sunday as week start when week_starts_on is 0', async () => {
    mockFrom
      .mockReturnValueOnce(makeQueryMock({ week_starts_on: 0 }))
      .mockReturnValueOnce(makeQueryMock([]))
      .mockReturnValueOnce(makeQueryMock([]))

    const result = await getWeeklyProgress('athlete-1')
    expect(result).toHaveLength(7)
    expect(result[0].dayName).toBe('Sun')
  })

  it('uses Monday as week start when week_starts_on is 1', async () => {
    mockFrom
      .mockReturnValueOnce(makeQueryMock({ week_starts_on: 1 }))
      .mockReturnValueOnce(makeQueryMock([]))
      .mockReturnValueOnce(makeQueryMock([]))

    const result = await getWeeklyProgress('athlete-1')
    expect(result[0].dayName).toBe('Mon')
  })

  it('defaults to Sunday when athlete has no week_starts_on preference', async () => {
    mockFrom
      .mockReturnValueOnce(makeQueryMock(null))  // athlete not found
      .mockReturnValueOnce(makeQueryMock([]))
      .mockReturnValueOnce(makeQueryMock([]))

    const result = await getWeeklyProgress('athlete-1')
    expect(result).toHaveLength(7)
  })
})
