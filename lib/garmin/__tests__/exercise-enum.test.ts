import { describe, it, expect } from 'vitest'
import {
  isKnownEnum,
  listCategories,
  listExercisesForCategory,
  flattenToPrompt,
  suggestClosestNames,
  isLiveEnum,
  enumSource,
} from '../exercise-enum'

describe('garmin exercise-enum helpers', () => {
  it('reports a live enum source', () => {
    // The shipped JSON is a live capture from the Garmin Connect web exercise
    // picker; if this fails, someone reverted to the stub JSON.
    expect(isLiveEnum()).toBe(true)
    expect(enumSource().source).not.toBe('stub')
    expect(enumSource().capturedAt).not.toBeNull()
  })

  it('isKnownEnum returns true for a pair in the table', () => {
    expect(isKnownEnum('PUSH_UP', 'PUSH_UP')).toBe(true)
    expect(isKnownEnum('PLANK', 'SIDE_PLANK')).toBe(true)
  })

  it('isKnownEnum returns false for unknown pairs', () => {
    expect(isKnownEnum('PUSH_UP', 'DOES_NOT_EXIST')).toBe(false)
    expect(isKnownEnum('NOT_A_CATEGORY', 'PUSH_UP')).toBe(false)
    expect(isKnownEnum(null, 'PUSH_UP')).toBe(false)
    expect(isKnownEnum('PUSH_UP', null)).toBe(false)
    expect(isKnownEnum(undefined, undefined)).toBe(false)
  })

  it('lists categories alphabetically', () => {
    const cats = listCategories()
    expect(cats.length).toBeGreaterThan(0)
    const sorted = [...cats].sort()
    expect(cats).toEqual(sorted)
    expect(cats).toContain('PUSH_UP')
    expect(cats).toContain('SQUAT')
  })

  it('lists exercises for a known category', () => {
    const names = listExercisesForCategory('PLANK')
    expect(names).toContain('PLANK')
    expect(names).toContain('SIDE_PLANK')
  })

  it('returns empty array for unknown category', () => {
    expect(listExercisesForCategory('UNKNOWN_CATEGORY')).toEqual([])
  })

  it('flattenToPrompt produces newline-separated CATEGORY: NAME lines', () => {
    const text = flattenToPrompt()
    expect(text).toMatch(/^PUSH_UP: .*PUSH_UP/m)
    expect(text.split('\n').length).toBe(listCategories().length)
  })

  it('suggestClosestNames returns token-overlap matches within a category', () => {
    const matches = suggestClosestNames('SQUAT', 'goblet')
    expect(matches[0]).toBe('GOBLET_SQUAT')
  })

  it('suggestClosestNames returns empty for no token overlap', () => {
    const matches = suggestClosestNames('SQUAT', 'completely unrelated phrase')
    expect(matches).toEqual([])
  })
})
