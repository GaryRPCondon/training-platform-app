import { describe, it, expect } from 'vitest'
import { buildCatalogLookup, resolveExerciseAgainstCatalog } from '../exercise-mapper'
import type { StrengthExerciseCatalog, StrengthExercise } from '@/types/database'

const catalog: StrengthExerciseCatalog[] = [
  {
    id: 1,
    canonical_name: 'pushup',
    display_name: 'Push-up',
    aliases: ['push-up', 'push up', 'press-up', 'press up'],
    measurement_type: 'reps',
    garmin_exercise_category: 'CHEST',
    garmin_exercise_name: 'PUSH_UP',
    garmin_step_type: 'STRENGTH',
    garmin_supported: true,
    created_at: '2026-05-19T00:00:00Z',
  },
  {
    id: 2,
    canonical_name: 'plank',
    display_name: 'Plank',
    aliases: ['front plank', 'forearm plank'],
    measurement_type: 'duration',
    garmin_exercise_category: 'PLANK',
    garmin_exercise_name: 'PLANK',
    garmin_step_type: 'STRENGTH',
    garmin_supported: false,
    created_at: '2026-05-19T00:00:00Z',
  },
]

const baseExercise = (overrides: Partial<StrengthExercise>): StrengthExercise => ({
  canonical_name: 'unknown',
  display_name: 'Unknown',
  user_text: 'unknown',
  measurement: { type: 'reps', sets: 1, reps_per_set: 10 },
  garmin_supported: false,
  ...overrides,
})

describe('resolveExerciseAgainstCatalog', () => {
  const lookup = buildCatalogLookup(catalog)

  it('matches by canonical name', () => {
    const result = resolveExerciseAgainstCatalog(
      baseExercise({ canonical_name: 'pushup', display_name: 'Push-up' }),
      lookup,
    )
    expect(result.canonical_name).toBe('pushup')
    expect(result.garmin_supported).toBe(true)
    expect(result.garmin_unsupported_reason).toBeUndefined()
  })

  it('matches by alias with case + separator variation', () => {
    const result = resolveExerciseAgainstCatalog(
      baseExercise({ canonical_name: 'Press-Up', display_name: 'press up' }),
      lookup,
    )
    expect(result.canonical_name).toBe('pushup')
    expect(result.display_name).toBe('Push-up')
    expect(result.garmin_supported).toBe(true)
  })

  it('marks catalog hit unsupported when row lacks Garmin support', () => {
    const result = resolveExerciseAgainstCatalog(
      baseExercise({ canonical_name: 'plank', display_name: 'Plank' }),
      lookup,
    )
    expect(result.canonical_name).toBe('plank')
    expect(result.garmin_supported).toBe(false)
    expect(result.garmin_unsupported_reason).toBe('Catalog entry missing Garmin IDs')
  })

  it('returns not-in-catalog reason when nothing matches', () => {
    const result = resolveExerciseAgainstCatalog(
      baseExercise({ canonical_name: 'nordic_curl', display_name: 'Nordic Curl', user_text: 'nordic curl' }),
      lookup,
    )
    expect(result.canonical_name).toBe('nordic_curl')
    expect(result.garmin_supported).toBe(false)
    expect(result.garmin_unsupported_reason).toBe('Exercise not in catalog')
  })

  it('falls back to user_text when canonical_name does not match', () => {
    const result = resolveExerciseAgainstCatalog(
      baseExercise({ canonical_name: 'misspelled', display_name: 'Misspelled', user_text: 'press up' }),
      lookup,
    )
    expect(result.canonical_name).toBe('pushup')
    expect(result.garmin_supported).toBe(true)
  })

  it('stamps catalog enum strings onto the exercise on catalog hit', () => {
    const result = resolveExerciseAgainstCatalog(
      baseExercise({ canonical_name: 'pushup' }),
      lookup,
    )
    expect(result.garmin_exercise_category).toBe('CHEST')
    expect(result.garmin_exercise_name).toBe('PUSH_UP')
    expect(result.garmin_match_quality).toBe('exact')
  })

  it('stamps LLM-suggested enum as exact when suggestion is confident + verbatim-known', () => {
    const result = resolveExerciseAgainstCatalog(
      baseExercise({
        canonical_name: 'nordic_curl',
        display_name: 'Nordic Curl',
        user_text: 'nordic curl',
        garmin_suggested_category: 'PLANK',
        garmin_suggested_name: 'SIDE_PLANK',
        garmin_suggested_confidence: 'exact',
      }),
      lookup,
    )
    expect(result.garmin_supported).toBe(true)
    expect(result.garmin_exercise_category).toBe('PLANK')
    expect(result.garmin_exercise_name).toBe('SIDE_PLANK')
    expect(result.garmin_match_quality).toBe('exact')
    expect(result.garmin_suggested_category).toBeUndefined()
    expect(result.garmin_suggested_name).toBeUndefined()
    expect(result.garmin_suggested_confidence).toBeUndefined()
  })

  it('accepts a partial-confidence suggestion and flags it approximate', () => {
    const result = resolveExerciseAgainstCatalog(
      baseExercise({
        canonical_name: 'nordic_curl',
        garmin_suggested_category: 'PLANK',
        garmin_suggested_name: 'SIDE_PLANK',
        garmin_suggested_confidence: 'partial',
      }),
      lookup,
    )
    expect(result.garmin_supported).toBe(true)
    expect(result.garmin_exercise_category).toBe('PLANK')
    expect(result.garmin_exercise_name).toBe('SIDE_PLANK')
    expect(result.garmin_match_quality).toBe('approximate')
  })

  it('fuzzily resolves a mis-spelled exact suggestion and flags it approximate', () => {
    // Garmin spells this 'BENT_OVER_ROW_WITH_DUMBELL' (one B); the model emits
    // the correct double-B spelling. We should still resolve to the real string.
    const result = resolveExerciseAgainstCatalog(
      baseExercise({
        canonical_name: 'dumbbell_bent_over_row',
        display_name: 'Dumbbell Bent-Over Row',
        user_text: 'dumbbell bent-over rows',
        garmin_suggested_category: 'ROW',
        garmin_suggested_name: 'BENT_OVER_ROW_WITH_DUMBBELL',
        garmin_suggested_confidence: 'exact',
      }),
      lookup,
    )
    expect(result.garmin_supported).toBe(true)
    expect(result.garmin_exercise_category).toBe('ROW')
    expect(result.garmin_exercise_name).toBe('BENT_OVER_ROW_WITH_DUMBELL')
    expect(result.garmin_match_quality).toBe('approximate')
  })

  it('ignores LLM suggestion when the category is not in the enum table', () => {
    const result = resolveExerciseAgainstCatalog(
      baseExercise({
        canonical_name: 'made_up_exercise',
        garmin_suggested_category: 'NOT_A_CATEGORY',
        garmin_suggested_name: 'FAKE_NAME',
        garmin_suggested_confidence: 'exact',
      }),
      lookup,
    )
    expect(result.garmin_supported).toBe(false)
    expect(result.garmin_unsupported_reason).toBe('Exercise not in catalog')
    expect(result.garmin_match_quality).toBeUndefined()
  })

  it('deterministically resolves by display name when the LLM gave no suggestion', () => {
    // Not in the test catalog, no LLM suggestion — the name search should still
    // find the verbatim Garmin entry and flag it approximate.
    const result = resolveExerciseAgainstCatalog(
      baseExercise({
        canonical_name: 'dumbbell_floor_press',
        display_name: 'Dumbbell Floor Press',
        user_text: 'dumbbell floor press x 3',
      }),
      lookup,
    )
    expect(result.garmin_supported).toBe(true)
    expect(result.garmin_exercise_category).toBe('BENCH_PRESS')
    expect(result.garmin_exercise_name).toBe('DUMBBELL_FLOOR_PRESS')
    expect(result.garmin_match_quality).toBe('approximate')
  })

  it('leaves a genuinely-absent exercise unsupported even via name search', () => {
    const result = resolveExerciseAgainstCatalog(
      baseExercise({
        canonical_name: 'banded_pallof_press',
        display_name: 'Banded Pallof Press',
        user_text: 'banded pallof press each side',
      }),
      lookup,
    )
    expect(result.garmin_supported).toBe(false)
    expect(result.garmin_unsupported_reason).toBe('Exercise not in catalog')
    expect(result.garmin_match_quality).toBeUndefined()
  })

  it('ignores a suggestion whose name has no close match in the category', () => {
    const result = resolveExerciseAgainstCatalog(
      baseExercise({
        canonical_name: 'made_up_exercise',
        garmin_suggested_category: 'PLANK',
        garmin_suggested_name: 'COMPLETELY_UNRELATED_NONSENSE_TOKEN',
        garmin_suggested_confidence: 'exact',
      }),
      lookup,
    )
    expect(result.garmin_supported).toBe(false)
    expect(result.garmin_unsupported_reason).toBe('Exercise not in catalog')
  })

  it('catalog hit overrides any LLM suggestion', () => {
    const result = resolveExerciseAgainstCatalog(
      baseExercise({
        canonical_name: 'pushup',
        garmin_suggested_category: 'PLANK',
        garmin_suggested_name: 'SIDE_PLANK',
        garmin_suggested_confidence: 'exact',
      }),
      lookup,
    )
    expect(result.garmin_exercise_category).toBe('CHEST')
    expect(result.garmin_exercise_name).toBe('PUSH_UP')
  })
})
