import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock Supabase client
// ---------------------------------------------------------------------------

const mockFrom = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({ from: mockFrom })),
}))

// Mock saveAdjustmentProposal as no-op to isolate decision logic
vi.mock('../adjustment-persistence', () => ({
  saveAdjustmentProposal: vi.fn().mockResolvedValue(undefined),
}))

import { proposeAdjustments } from '../adjustment-proposer'

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
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
  }
  mock.then = (onfulfilled: any, onrejected?: any) =>
    Promise.resolve(result).then(onfulfilled, onrejected)
  return mock
}

function makeWorkout(overrides = {}) {
  return {
    id: Math.floor(Math.random() * 1000),
    scheduled_date: '2026-03-25',
    workout_type: 'easy_run',
    status: 'scheduled',
    completed_activity_id: null,
    distance_target_meters: 10000,
    ...overrides,
  }
}

const WEEK_START = '2026-03-23'
const CURRENT_WEEK = { id: 'week-1', week_start_date: WEEK_START, weekly_volume_target: 40 }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('proposeAdjustments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty array when no current week plan found', async () => {
    mockFrom.mockReturnValueOnce(makeQueryMock(null))  // weekly_plans → null
    const result = await proposeAdjustments('athlete-1')
    expect(result).toHaveLength(0)
  })

  it('returns empty array when all workouts are completed (0 missed)', async () => {
    const workouts = [
      makeWorkout({ scheduled_date: '2026-03-24', completed_activity_id: 1 }),
      makeWorkout({ scheduled_date: '2026-03-25', completed_activity_id: 2 }),
    ]
    mockFrom
      .mockReturnValueOnce(makeQueryMock(CURRENT_WEEK))   // weekly_plans
      .mockReturnValueOnce(makeQueryMock(workouts))        // planned_workouts
      .mockReturnValueOnce(makeQueryMock([                 // activities
        { id: 1, distance_meters: 10000 },
        { id: 2, distance_meters: 10000 },
      ]))

    const result = await proposeAdjustments('athlete-1')
    expect(result).toHaveLength(0)
  })

  it('proposes reduce_volume when 2 or more workouts missed', async () => {
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)
    const dayBefore = new Date(today)
    dayBefore.setDate(today.getDate() - 2)
    const tomorrow = new Date(today)
    tomorrow.setDate(today.getDate() + 1)

    const workouts = [
      makeWorkout({ id: 1, scheduled_date: formatDate(dayBefore), status: 'scheduled', completed_activity_id: null }),
      makeWorkout({ id: 2, scheduled_date: formatDate(yesterday), status: 'scheduled', completed_activity_id: null }),
      makeWorkout({ id: 3, scheduled_date: formatDate(tomorrow) }),
    ]
    mockFrom
      .mockReturnValueOnce(makeQueryMock(CURRENT_WEEK))
      .mockReturnValueOnce(makeQueryMock(workouts))
      .mockReturnValueOnce(makeQueryMock([]))

    const result = await proposeAdjustments('athlete-1')
    expect(result.some(a => a.type === 'reduce_volume')).toBe(true)
  })

  it('reduce_volume proposal cuts upcoming workout distances by 20%', async () => {
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)
    const dayBefore = new Date(today)
    dayBefore.setDate(today.getDate() - 2)
    const tomorrow = new Date(today)
    tomorrow.setDate(today.getDate() + 1)

    const upcomingWorkout = makeWorkout({ id: 3, scheduled_date: formatDate(tomorrow), distance_target_meters: 10000 })
    const workouts = [
      makeWorkout({ id: 1, scheduled_date: formatDate(dayBefore), status: 'scheduled', completed_activity_id: null }),
      makeWorkout({ id: 2, scheduled_date: formatDate(yesterday), status: 'scheduled', completed_activity_id: null }),
      upcomingWorkout,
    ]
    mockFrom
      .mockReturnValueOnce(makeQueryMock(CURRENT_WEEK))
      .mockReturnValueOnce(makeQueryMock(workouts))
      .mockReturnValueOnce(makeQueryMock([]))

    const result = await proposeAdjustments('athlete-1')
    const volumeAdjustment = result.find(a => a.type === 'reduce_volume')!
    expect(volumeAdjustment).toBeDefined()
    const change = volumeAdjustment.proposedChanges.workouts[0]
    expect(change.newDistance).toBe(8000)  // 10000 * 0.8
  })

  it('proposes add_recovery when planned volume > 60km and completion rate < 60%', async () => {
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)
    const tomorrow = new Date(today)
    tomorrow.setDate(today.getDate() + 1)

    const workouts = [
      makeWorkout({ id: 1, scheduled_date: formatDate(yesterday), status: 'scheduled', completed_activity_id: null }),
      makeWorkout({ id: 2, scheduled_date: formatDate(tomorrow), workout_type: 'intervals' }),
    ]
    const highVolumeWeek = { ...CURRENT_WEEK, weekly_volume_target: 65 }
    mockFrom
      .mockReturnValueOnce(makeQueryMock(highVolumeWeek))
      .mockReturnValueOnce(makeQueryMock(workouts))
      .mockReturnValueOnce(makeQueryMock([]))  // 0 activities completed → 0%

    const result = await proposeAdjustments('athlete-1')
    expect(result.some(a => a.type === 'add_recovery')).toBe(true)
  })

  it('does not propose add_recovery when volume <= 60km', async () => {
    const today = new Date()
    const tomorrow = new Date(today)
    tomorrow.setDate(today.getDate() + 1)

    const workouts = [
      makeWorkout({ id: 2, scheduled_date: formatDate(tomorrow), workout_type: 'intervals' }),
    ]
    const normalWeek = { ...CURRENT_WEEK, weekly_volume_target: 40 }
    mockFrom
      .mockReturnValueOnce(makeQueryMock(normalWeek))
      .mockReturnValueOnce(makeQueryMock(workouts))
      .mockReturnValueOnce(makeQueryMock([]))

    const result = await proposeAdjustments('athlete-1')
    expect(result.some(a => a.type === 'add_recovery')).toBe(false)
  })

  it('proposes reschedule when long_run is within 3 days and 2+ workouts missed', async () => {
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)
    const dayBefore = new Date(today)
    dayBefore.setDate(today.getDate() - 2)
    const inTwoDays = new Date(today)
    inTwoDays.setDate(today.getDate() + 2)

    const workouts = [
      makeWorkout({ id: 1, scheduled_date: formatDate(dayBefore), status: 'scheduled', completed_activity_id: null }),
      makeWorkout({ id: 2, scheduled_date: formatDate(yesterday), status: 'scheduled', completed_activity_id: null }),
      makeWorkout({ id: 3, scheduled_date: formatDate(inTwoDays), workout_type: 'long_run' }),
    ]
    mockFrom
      .mockReturnValueOnce(makeQueryMock(CURRENT_WEEK))
      .mockReturnValueOnce(makeQueryMock(workouts))
      .mockReturnValueOnce(makeQueryMock([]))

    const result = await proposeAdjustments('athlete-1')
    expect(result.some(a => a.type === 'reschedule')).toBe(true)
  })

  it('reschedule proposal moves long_run 7 days forward', async () => {
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)
    const dayBefore = new Date(today)
    dayBefore.setDate(today.getDate() - 2)
    const inTwoDays = new Date(today)
    inTwoDays.setDate(today.getDate() + 2)

    const longRunDate = formatDate(inTwoDays)
    const workouts = [
      makeWorkout({ id: 1, scheduled_date: formatDate(dayBefore), status: 'scheduled', completed_activity_id: null }),
      makeWorkout({ id: 2, scheduled_date: formatDate(yesterday), status: 'scheduled', completed_activity_id: null }),
      makeWorkout({ id: 3, scheduled_date: longRunDate, workout_type: 'long_run' }),
    ]
    mockFrom
      .mockReturnValueOnce(makeQueryMock(CURRENT_WEEK))
      .mockReturnValueOnce(makeQueryMock(workouts))
      .mockReturnValueOnce(makeQueryMock([]))

    const result = await proposeAdjustments('athlete-1')
    const reschedule = result.find(a => a.type === 'reschedule')!
    expect(reschedule.proposedChanges.currentDate).toBe(longRunDate)
    // New date should be 7 days later
    const expectedNewDate = new Date(longRunDate)
    expectedNewDate.setDate(expectedNewDate.getDate() + 7)
    expect(reschedule.proposedChanges.newDate).toBe(formatDate(expectedNewDate))
  })
})

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]
}
