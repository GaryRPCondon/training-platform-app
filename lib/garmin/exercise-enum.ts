/**
 * Garmin exercise enum helpers.
 *
 * The JSON file behind this module is the canonical lookup table for
 * (exerciseCategory, exerciseName) pairs that the Garmin Connect API
 * accepts. While the source is "stub", only the small set of placeholders
 * baked into seed-exercise-catalog.ts is known; once the user does the
 * one-time Garmin Connect Network capture documented in
 * docs/garmin_exercise_catalog.md, this file will hold the full ~1,500-row
 * tree and the rest of the strength pipeline auto-extends.
 */

import enumData from './garmin-exercise-enum.json'

interface EnumFile {
  captured_at: string | null
  source: string
  notes?: string
  categories: Record<string, string[]>
}

const ENUM = enumData as EnumFile

const CATEGORY_SET = new Set(Object.keys(ENUM.categories))

const EXERCISE_BY_CATEGORY = new Map<string, Set<string>>(
  Object.entries(ENUM.categories).map(([cat, names]) => [cat, new Set(names)]),
)

/** True when the enum table has been populated from a real Garmin capture. */
export function isLiveEnum(): boolean {
  return ENUM.source !== 'stub' && !!ENUM.captured_at
}

export function enumSource(): { source: string; capturedAt: string | null } {
  return { source: ENUM.source, capturedAt: ENUM.captured_at }
}

/** Deterministic O(1) check: is this (category, exerciseName) pair known to Garmin? */
export function isKnownEnum(category: string | null | undefined, exerciseName: string | null | undefined): boolean {
  if (!category || !exerciseName) return false
  const names = EXERCISE_BY_CATEGORY.get(category)
  return !!names && names.has(exerciseName)
}

export function listCategories(): string[] {
  return Array.from(CATEGORY_SET).sort()
}

export function listExercisesForCategory(category: string): string[] {
  const names = EXERCISE_BY_CATEGORY.get(category)
  return names ? Array.from(names).sort() : []
}

/**
 * Compact, LLM-friendly digest of the full enum. Format:
 *   CATEGORY: NAME1, NAME2, NAME3
 *   CATEGORY: NAME1, ...
 * Suitable for embedding directly into a system prompt; ~10-20 tokens per
 * category line.
 */
export function flattenToPrompt(): string {
  const lines: string[] = []
  for (const category of listCategories()) {
    const names = listExercisesForCategory(category)
    lines.push(`${category}: ${names.join(', ')}`)
  }
  return lines.join('\n')
}

/**
 * Find the closest exercise names within a category by simple substring /
 * token overlap. Used by the verifier and the review CLI to suggest fixes
 * when an AI-guessed enum string doesn't match exactly.
 */
export function suggestClosestNames(category: string, query: string, limit = 5): string[] {
  const names = listExercisesForCategory(category)
  if (names.length === 0) return []
  const queryTokens = tokenize(query)

  const scored = names.map(name => ({
    name,
    score: tokenize(name).reduce((acc, t) => acc + (queryTokens.includes(t) ? 1 : 0), 0),
  }))
  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.name)
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
}
