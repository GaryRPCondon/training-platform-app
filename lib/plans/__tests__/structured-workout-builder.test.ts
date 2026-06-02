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
              { distance_meters: 1600, intensity: 'hard', role: 'work' },
              { distance_meters: 400, intensity: 'recovery', role: 'recovery' },
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
                { distance_meters: 800, intensity: 'hard', role: 'work' },
                { distance_meters: 400, intensity: 'recovery', role: 'recovery' },
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

  describe('10K-shaped sessions', () => {
    it('preserves race-pace 10K intervals (5×1km @ race_10k, 90s recovery)', () => {
      const result = buildStructuredWorkout({
        type: 'intervals',
        intensity: 'race_10k',
        structured_workout: {
          warmup: { duration_minutes: 15, intensity: 'easy' },
          main_set: [{
            repeat: 5,
            intervals: [
              { distance_meters: 1000, intensity: 'race_10k', role: 'work' },
              { duration_seconds: 90, intensity: 'recovery', role: 'recovery' },
            ],
          }],
          cooldown: { duration_minutes: 10, intensity: 'easy' },
        },
      })

      const mainSet = result.main_set as Array<{ repeat: number; intervals: Array<Record<string, unknown>> }>
      expect(mainSet).toHaveLength(1)
      expect(mainSet[0].repeat).toBe(5)
      expect(mainSet[0].intervals).toHaveLength(2)
      // Mixed distance + duration in one repeat group survives normalization
      expect(mainSet[0].intervals[0]).toMatchObject({ distance_meters: 1000, intensity: 'race_10k' })
      expect(mainSet[0].intervals[1]).toMatchObject({ duration_seconds: 90, intensity: 'recovery' })
    })

    it('handles mixed T-pace and race-pace within one workout (two main_set groups)', () => {
      const result = buildStructuredWorkout({
        type: 'intervals',
        intensity: 'tempo',
        structured_workout: {
          warmup: { duration_minutes: 15, intensity: 'easy' },
          main_set: [
            { repeat: 1, intervals: [{ distance_meters: 3000, intensity: 'tempo' }]},
            { repeat: 1, intervals: [{ duration_seconds: 120, intensity: 'recovery' }]},
            { repeat: 3, intervals: [
              { distance_meters: 1000, intensity: 'race_10k', role: 'work' },
              { duration_seconds: 90, intensity: 'recovery', role: 'recovery' },
            ]},
          ],
          cooldown: { duration_minutes: 10, intensity: 'easy' },
        },
      })

      const mainSet = result.main_set as Array<{ repeat: number; intervals: Array<Record<string, unknown>> }>
      expect(mainSet).toHaveLength(3)
      expect(mainSet[0].intervals[0]).toMatchObject({ intensity: 'tempo' })
      expect(mainSet[2].repeat).toBe(3)
      expect(mainSet[2].intervals[0]).toMatchObject({ intensity: 'race_10k' })
    })

    it('handles threshold segment embedded in a long easy run', () => {
      const result = buildStructuredWorkout({
        type: 'long_run',
        intensity: 'easy',
        structured_workout: {
          main_set: [
            { repeat: 1, intervals: [{ distance_meters: 8000, intensity: 'easy' }]},
            { repeat: 1, intervals: [{ distance_meters: 6000, intensity: 'tempo' }]},
            { repeat: 1, intervals: [{ distance_meters: 8000, intensity: 'easy' }]},
          ],
        },
      })

      const mainSet = result.main_set as Array<{ repeat: number; intervals: Array<Record<string, unknown>> }>
      expect(mainSet).toHaveLength(3)
      expect(mainSet[0].intervals[0]).toMatchObject({ distance_meters: 8000, intensity: 'easy' })
      expect(mainSet[1].intervals[0]).toMatchObject({ distance_meters: 6000, intensity: 'tempo' })
      expect(mainSet[2].intervals[0]).toMatchObject({ distance_meters: 8000, intensity: 'easy' })
    })

    it('emits time-based threshold session correctly (4×6min @ T pace, 90s rest)', () => {
      const result = buildStructuredWorkout({
        type: 'tempo',
        intensity: 'tempo',
        structured_workout: {
          warmup: { duration_minutes: 15, intensity: 'easy' },
          main_set: [{
            repeat: 4,
            intervals: [
              { duration_seconds: 360, intensity: 'tempo', role: 'work' },
              { duration_seconds: 90, intensity: 'recovery', role: 'recovery' },
            ],
          }],
          cooldown: { duration_minutes: 10, intensity: 'easy' },
        },
      })

      const mainSet = result.main_set as Array<{ repeat: number; intervals: Array<Record<string, unknown>> }>
      expect(mainSet).toHaveLength(1)
      expect(mainSet[0].repeat).toBe(4)
      // duration_seconds is preserved on main_set intervals (only warmup/cooldown are normalized to minutes)
      expect(mainSet[0].intervals[0]).toMatchObject({ duration_seconds: 360, intensity: 'tempo' })
      expect(mainSet[0].intervals[1]).toMatchObject({ duration_seconds: 90, intensity: 'recovery' })
      // Warmup/cooldown stay in minutes
      expect(result.warmup).toEqual({ duration_minutes: 15, intensity: 'easy' })
      expect(result.cooldown).toEqual({ duration_minutes: 10, intensity: 'easy' })
    })
  })

  describe('role contract', () => {
    it('throws on a multi-interval repeat missing role on any child', () => {
      expect(() => buildStructuredWorkout({
        type: 'intervals',
        intensity: 'hard',
        structured_workout: {
          main_set: [
            { repeat: 5, intervals: [
              { distance_meters: 1000, intensity: 'T', role: 'work' },
              { duration_seconds: 60, intensity: 'E' },  // role missing
            ]},
          ],
        },
      })).toThrow(/main_set\[0\]\.intervals\[1\] missing required "role"/)
    })

    it('throws on an invalid role value', () => {
      expect(() => buildStructuredWorkout({
        type: 'intervals',
        intensity: 'hard',
        structured_workout: {
          main_set: [
            { repeat: 5, intervals: [
              { distance_meters: 1000, intensity: 'T', role: 'shakeout' as 'work' },
              { duration_seconds: 60, intensity: 'E', role: 'recovery' },
            ]},
          ],
        },
      })).toThrow(/role="shakeout" invalid/)
    })

    it('defaults role to "work" on single-interval repeats when omitted', () => {
      const result = buildStructuredWorkout({
        type: 'intervals',
        intensity: 'hard',
        structured_workout: {
          main_set: [
            { repeat: 8, intervals: [{ distance_meters: 400, intensity: 'I' }] },
          ],
        },
      })
      const mainSet = result.main_set as Array<{ intervals: Array<{ role?: string }> }>
      expect(mainSet[0].intervals[0].role).toBe('work')
    })

    it('preserves explicit roles through normalization', () => {
      const result = buildStructuredWorkout({
        type: 'intervals',
        intensity: 'hard',
        structured_workout: {
          main_set: [
            { repeat: 6, intervals: [
              { duration_seconds: 120, intensity: 'marathon_pace', role: 'work' },
              { duration_seconds: 120, intensity: '10k_pace', role: 'work' },
              { duration_seconds: 30, intensity: 'mile_pace', role: 'work' },
            ]},
          ],
        },
      })
      const mainSet = result.main_set as Array<{ intervals: Array<{ role?: string }> }>
      expect(mainSet[0].intervals.map(i => i.role)).toEqual(['work', 'work', 'work'])
    })

    it('accepts role:"warmup" and role:"cooldown" for W/C-included sessions embedded in main_set', () => {
      const result = buildStructuredWorkout({
        type: 'tempo',
        intensity: 'tempo',
        structured_workout: {
          main_set: [
            { repeat: 1, intervals: [
              { distance_meters: 5000, intensity: 'E', role: 'warmup' },
              { distance_meters: 2000, intensity: 'T', role: 'work' },
              { distance_meters: 2000, intensity: 'E', role: 'cooldown' },
            ]},
          ],
        },
      })
      const mainSet = result.main_set as Array<{ intervals: Array<{ role?: string }> }>
      expect(mainSet[0].intervals.map(i => i.role)).toEqual(['warmup', 'work', 'cooldown'])
    })

    it('accepts role:"rest" alongside role:"work" and role:"recovery"', () => {
      const result = buildStructuredWorkout({
        type: 'intervals',
        intensity: 'speed',
        structured_workout: {
          main_set: [
            { repeat: 6, intervals: [
              { duration_seconds: 10, intensity: 'speed', role: 'work' },
              { duration_seconds: 90, intensity: 'rest', role: 'rest' },
            ]},
          ],
        },
      })
      const mainSet = result.main_set as Array<{ intervals: Array<{ role?: string }> }>
      expect(mainSet[0].intervals.map(i => i.role)).toEqual(['work', 'rest'])
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
