import { describe, it, expect } from 'vitest'
import {
  exerciseMeasurementSchema,
  parsedSessionSchema,
  parsedProgramSchema,
  parseLLMResultSchema,
} from '../schemas'

// Regression: Gemini began emitting `"rest_seconds": null` on rest-less exercises
// instead of omitting the key. Zod's .optional() accepts undefined only, so every
// strength import died with a 422 and 48 identical validation errors. Optional
// fields at an LLM boundary must treat null as "absent".
describe('strength schemas — null tolerance at the LLM boundary', () => {
  const repsExercise = { type: 'reps' as const, sets: 3, reps_per_set: 10 }

  it('accepts a null rest_seconds and normalises it to undefined', () => {
    const result = exerciseMeasurementSchema.safeParse({ ...repsExercise, rest_seconds: null })

    expect(result.success).toBe(true)
    // Normalised, not merely permitted — the refine below tests `!== undefined`,
    // so a surviving null would satisfy it while carrying no value.
    expect(result.success && result.data.rest_seconds).toBeUndefined()
  })

  it('accepts nulls across every optional measurement field', () => {
    const result = exerciseMeasurementSchema.safeParse({
      type: 'duration',
      sets: 2,
      duration_seconds: 35,
      reps_per_set: null,
      distance_meters: null,
      rest_seconds: null,
    })

    expect(result.success).toBe(true)
    expect(result.success && result.data.reps_per_set).toBeUndefined()
  })

  it('still rejects a measurement whose own value field is null', () => {
    // Genuinely missing data — the refine must still fire.
    const result = exerciseMeasurementSchema.safeParse({
      type: 'duration', sets: 3, duration_seconds: null,
    })
    expect(result.success).toBe(false)
  })

  it('still rejects a wrongly typed value', () => {
    const result = exerciseMeasurementSchema.safeParse({ ...repsExercise, rest_seconds: 'ninety' })
    expect(result.success).toBe(false)
  })

  it('tolerates nulls on optional session and program fields', () => {
    const exercise = {
      canonical_name: 'plank',
      display_name: 'Front Plank',
      user_text: '60 second front plank x 3 sets',
      measurement: { type: 'duration' as const, sets: 3, duration_seconds: 60, rest_seconds: null },
      garmin_supported: false,
      notes: null,
      garmin_suggested_confidence: null,
    }

    const session = parsedSessionSchema.safeParse({
      session_index: 1,
      title: 'Core',
      exercises: [exercise],
      estimated_duration_minutes: null,
      coaching_note: null,
      week_index: null,
      day_index: null,
      load_category: null,
    })
    // Narrow before reusing, so a regression here fails on its own assertion rather
    // than as a confusing nested error in the program parse below.
    if (!session.success) throw new Error(`session parse failed: ${session.error.message}`)

    const program = parsedProgramSchema.safeParse({
      schema_version: '1.0',
      content_type: 'strength',
      name: 'Core programme',
      description: null,
      sessions: [session.data],
      parse_warnings: null,
    })
    expect(program.success).toBe(true)
  })

  it('tolerates a null top-level warnings list and defaults it to empty', () => {
    // `.default([])` substitutes for undefined only, so `"warnings": null` failed
    // outright — the same drift one level above the fields fixed above.
    const result = parseLLMResultSchema.safeParse({
      program: {
        schema_version: '1.0',
        content_type: 'strength',
        name: 'P',
        sessions: [{
          session_index: 1,
          title: 'S',
          exercises: [{
            canonical_name: 'pushup',
            display_name: 'Push-up',
            user_text: '3 x 10 pushups',
            measurement: { type: 'reps', sets: 3, reps_per_set: 10, rest_seconds: null },
            garmin_supported: false,
          }],
        }],
      },
      confidence: 0.9,
      content_type: 'strength',
      warnings: null,
    })

    expect(result.success).toBe(true)
    expect(result.success && result.data.warnings).toEqual([])
  })
})
