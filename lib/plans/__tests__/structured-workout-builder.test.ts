import { describe, it, expect } from 'vitest'
import { buildStructuredWorkout } from '../structured-workout-builder'

describe('buildStructuredWorkout', () => {
  describe('pass-through behavior', () => {
    it('passes through LLM-emitted warmup, main_set, and cooldown for intervals', () => {
      const result = buildStructuredWorkout({
        type: 'intervals',
        intensity: 'hard',
        structured_workout: {
          warmup: { duration_minutes: 15, intensity: 'easy' },
          main_set: [
            { repeat: 3, intervals: [
              { distance_meters: 1600, intensity: 'hard' },
              { distance_meters: 400, intensity: 'recovery' },
            ]},
          ],
          cooldown: { duration_minutes: 10, intensity: 'easy' },
        },
      })

      expect(result.warmup).toEqual({ duration_minutes: 15, intensity: 'easy' })
      expect(result.cooldown).toEqual({ duration_minutes: 10, intensity: 'easy' })
      expect(result.main_set).toHaveLength(1)
    })

    it('omits warmup/cooldown when LLM omits them (no synthesis)', () => {
      const result = buildStructuredWorkout({
        type: 'intervals',
        intensity: 'hard',
        structured_workout: {
          main_set: [
            { repeat: 3, intervals: [{ distance_meters: 1600, intensity: 'hard' }]},
          ],
        },
      })

      expect(result.warmup).toBeUndefined()
      expect(result.cooldown).toBeUndefined()
      expect(result.main_set).toHaveLength(1)
    })

    it('passes through tempo structured_workout as-is', () => {
      const result = buildStructuredWorkout({
        type: 'tempo',
        intensity: 'lactate_threshold',
        structured_workout: {
          warmup: { duration_minutes: 10, intensity: 'easy' },
          main_set: [
            { repeat: 1, intervals: [{ duration_seconds: 1200, intensity: 'lactate_threshold' }]},
          ],
          cooldown: { duration_minutes: 10, intensity: 'easy' },
        },
      })

      expect(result.warmup).toEqual({ duration_minutes: 10, intensity: 'easy' })
      expect(result.cooldown).toEqual({ duration_minutes: 10, intensity: 'easy' })
      expect(result.main_set).toHaveLength(1)
    })

    it('passes through plain easy_run main_set', () => {
      const result = buildStructuredWorkout({
        type: 'easy_run',
        intensity: 'easy',
        pace_guidance: 'Conversational',
        structured_workout: {
          main_set: [
            { repeat: 1, intervals: [{ distance_meters: 8000, intensity: 'easy' }]},
          ],
        },
      })

      expect(result.warmup).toBeUndefined()
      expect(result.cooldown).toBeUndefined()
      expect(result.main_set).toHaveLength(1)
      expect(result.pace_guidance).toBe('Conversational')
    })
  })

  describe('non-running types', () => {
    it('returns only pace_guidance/notes for rest', () => {
      const result = buildStructuredWorkout({
        type: 'rest',
        intensity: 'rest',
      })

      expect(result.main_set).toBeUndefined()
      expect(result.warmup).toBeUndefined()
      expect(result.cooldown).toBeUndefined()
    })

    it('returns only pace_guidance/notes for race even with structured_workout', () => {
      const result = buildStructuredWorkout({
        type: 'race',
        intensity: 'race',
        structured_workout: {
          main_set: [{ repeat: 1, intervals: [{ distance_meters: 42195, intensity: 'race' }]}],
        },
      })

      expect(result.main_set).toBeUndefined()
    })
  })

  describe('normalization', () => {
    it('converts duration_seconds on warmup to duration_minutes', () => {
      const result = buildStructuredWorkout({
        type: 'intervals',
        intensity: 'hard',
        structured_workout: {
          warmup: { duration_seconds: 600, intensity: 'easy' },
          main_set: [{ repeat: 1, intervals: [{ distance_meters: 1000, intensity: 'hard' }]}],
        },
      })

      expect(result.warmup).toEqual({ duration_minutes: 10, intensity: 'easy' })
    })

    it('flattens nested repeat groups inside parent repeat:1', () => {
      const result = buildStructuredWorkout({
        type: 'intervals',
        intensity: 'hard',
        structured_workout: {
          main_set: [{
            repeat: 1,
            intervals: [
              { distance_meters: 1600, intensity: 'easy' },
              { repeat: 3, intervals: [
                { distance_meters: 800, intensity: 'hard' },
                { distance_meters: 400, intensity: 'recovery' },
              ]},
            ],
          }],
        },
      })

      const mainSet = result.main_set as Array<{ repeat: number; intervals: unknown[] }>
      expect(mainSet).toHaveLength(2)
      expect(mainSet[0].repeat).toBe(1)
      expect(mainSet[1].repeat).toBe(3)
    })

    it('wraps flat step arrays into single-rep groups', () => {
      const result = buildStructuredWorkout({
        type: 'intervals',
        intensity: 'hard',
        structured_workout: {
          main_set: [
            { distance_meters: 1600, intensity: 'easy' },
            { distance_meters: 800, intensity: 'hard' },
          ] as unknown as Record<string, unknown>[],
        },
      })

      const mainSet = result.main_set as Array<{ repeat: number; intervals: unknown[] }>
      expect(mainSet).toHaveLength(2)
      expect(mainSet[0].repeat).toBe(1)
      expect(mainSet[1].repeat).toBe(1)
    })
  })

  describe('without structured_workout', () => {
    it('returns only pace_guidance/notes when LLM omits structured_workout', () => {
      const result = buildStructuredWorkout({
        type: 'easy_run',
        intensity: 'easy',
        pace_guidance: 'Conversational',
        notes: 'Take it easy',
      })

      expect(result.warmup).toBeUndefined()
      expect(result.cooldown).toBeUndefined()
      expect(result.main_set).toBeUndefined()
      expect(result.pace_guidance).toBe('Conversational')
      expect(result.notes).toBe('Take it easy')
    })
  })
})
