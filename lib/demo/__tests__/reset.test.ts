import { describe, it, expect } from 'vitest'
import { buildIdMap, remapId, remapForInsert } from '@/lib/demo/reset'

const DEMO = '00000000-0000-0000-0000-000000000demo'

describe('buildIdMap', () => {
  it('zips source ids to inserted ids by position', () => {
    const map = buildIdMap([{ id: 10 }, { id: 20 }, { id: 30 }], [{ id: 1 }, { id: 2 }, { id: 3 }])
    expect(map.get(10)).toBe(1)
    expect(map.get(20)).toBe(2)
    expect(map.get(30)).toBe(3)
  })

  it('throws on a length mismatch (corrupted clone must fail loud)', () => {
    expect(() => buildIdMap([{ id: 1 }, { id: 2 }], [{ id: 9 }])).toThrow(/length mismatch/)
  })

  it('handles empty input', () => {
    expect(buildIdMap([], []).size).toBe(0)
  })
})

describe('remapId', () => {
  const map = new Map<number, number>([[5, 55]])
  it('maps a known id', () => expect(remapId(map, 5)).toBe(55))
  it('passes null through', () => expect(remapId(map, null)).toBeNull())
  it('passes undefined through as null', () => expect(remapId(map, undefined)).toBeNull())
  it('returns null for an unmapped id (never a dangling ref)', () => expect(remapId(map, 999)).toBeNull())
})

describe('remapForInsert', () => {
  it('drops the PK and repoints athlete_id at the demo athlete', () => {
    const out = remapForInsert({ id: 7, athlete_id: 'real-user', name: 'x' }, { demoAthleteId: DEMO })
    expect(out.id).toBeUndefined()
    expect(out.athlete_id).toBe(DEMO)
    expect(out.name).toBe('x')
  })

  it('remaps FK columns through their id maps', () => {
    const weeklyMap = new Map<number, number>([[100, 900]])
    const out = remapForInsert(
      { id: 1, athlete_id: 'real', weekly_plan_id: 100, completed_activity_id: 42 },
      { demoAthleteId: DEMO, remaps: { weekly_plan_id: weeklyMap }, nullColumns: ['completed_activity_id'] },
    )
    expect(out.weekly_plan_id).toBe(900)
    expect(out.completed_activity_id).toBeNull()
  })

  it('nulls an FK whose source id is not in the map', () => {
    const out = remapForInsert(
      { id: 1, activity_id: 12345 },
      { demoAthleteId: DEMO, remaps: { activity_id: new Map() } },
    )
    expect(out.activity_id).toBeNull()
  })

  it('leaves child tables without athlete_id untouched on that column', () => {
    const out = remapForInsert({ id: 3, activity_id: 5, pace: 300 }, { demoAthleteId: DEMO })
    expect('athlete_id' in out).toBe(false)
    expect(out.pace).toBe(300)
  })
})
