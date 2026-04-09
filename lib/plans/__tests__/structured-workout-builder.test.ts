import { describe, it, expect } from 'vitest'
import { buildStructuredWorkout } from '../structured-workout-builder'

describe('buildStructuredWorkout', () => {
  describe('intervals — default warmup/cooldown', () => {
    it('adds 15min warmup and 10min cooldown when LLM provides no warmup', () => {
      const result = buildStructuredWorkout({
        type: 'intervals',
        distance_meters: 10000,
        intensity: 'hard',
        structured_workout: {
          main_set: [
            { repeat: 3, intervals: [
              { distance_meters: 1600, intensity: 'hard' },
              { distance_meters: 400, intensity: 'recovery' },
            ]},
          ],
        },
      })

      expect(result.warmup).toEqual({ duration_minutes: 15, intensity: 'easy' })
      expect(result.cooldown).toEqual({ duration_minutes: 10, intensity: 'easy' })
      expect(result.main_set).toHaveLength(1)
    })
  })

  describe('intervals — LLM-provided warmup/cooldown', () => {
    it('uses LLM warmup and omits cooldown when LLM provides warmup but no cooldown', () => {
      const result = buildStructuredWorkout({
        type: 'intervals',
        distance_meters: 2800,
        intensity: 'easy',
        structured_workout: {
          warmup: { duration_minutes: 5, intensity: 'easy' },
          main_set: [
            { repeat: 8, intervals: [
              { duration_seconds: 60, intensity: 'easy' },
              { duration_seconds: 90, intensity: 'recovery' },
            ]},
          ],
        },
      })

      expect(result.warmup).toEqual({ duration_minutes: 5, intensity: 'easy' })
      expect(result.cooldown).toBeUndefined()
      expect(result.main_set).toHaveLength(1)
    })

    it('uses LLM warmup and cooldown when both provided', () => {
      const result = buildStructuredWorkout({
        type: 'intervals',
        distance_meters: 5000,
        intensity: 'easy',
        structured_workout: {
          warmup: { duration_minutes: 5, intensity: 'easy' },
          main_set: [
            { repeat: 1, intervals: [
              { duration_seconds: 300, intensity: 'easy' },
              { duration_seconds: 180, intensity: 'recovery' },
            ]},
          ],
          cooldown: { duration_minutes: 3, intensity: 'easy' },
        },
      })

      expect(result.warmup).toEqual({ duration_minutes: 5, intensity: 'easy' })
      expect(result.cooldown).toEqual({ duration_minutes: 3, intensity: 'easy' })
    })
  })

  describe('tempo', () => {
    it('always uses default warmup/cooldown', () => {
      const result = buildStructuredWorkout({
        type: 'tempo',
        distance_meters: 8000,
        intensity: 'tempo',
      })

      expect(result.warmup).toEqual({ duration_minutes: 10, intensity: 'easy' })
      expect(result.cooldown).toEqual({ duration_minutes: 10, intensity: 'easy' })
    })
  })

  describe('easy_run', () => {
    it('returns only pace_guidance and notes', () => {
      const result = buildStructuredWorkout({
        type: 'easy_run',
        distance_meters: 5000,
        intensity: 'easy',
        pace_guidance: 'Conversational',
      })

      expect(result.warmup).toBeUndefined()
      expect(result.cooldown).toBeUndefined()
      expect(result.main_set).toBeUndefined()
      expect(result.pace_guidance).toBe('Conversational')
    })
  })
})
