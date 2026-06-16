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

/**
 * Resolve an LLM-suggested enum name to the verbatim string Garmin actually
 * accepts, tolerating the spelling/token noise the model introduces.
 *
 * The Garmin enum is littered with non-obvious spellings (e.g.
 * `BENT_OVER_ROW_WITH_DUMBELL` — one B) and token orderings the model won't
 * reproduce character-for-character. A strict `isKnownEnum` check throws those
 * away even when the model picked the right exercise. This resolver walks three
 * tiers within the suggested category:
 *   1. verbatim hit,
 *   2. normalised equality (case / separators / punctuation stripped),
 *   3. fuzzy token match — every query token has an exact or near-exact
 *      (edit-distance ≤ 1–2) counterpart in the candidate, scored ≥ 0.8.
 * Returns the canonical Garmin string (always a verbatim member of the
 * category, so it is always safe to send) or null when nothing is close enough.
 * Search is scoped to the suggested category; a wrong category yields null.
 */
export function resolveEnumName(
  category: string | null | undefined,
  suggestedName: string | null | undefined,
): string | null {
  if (!category || !suggestedName) return null
  const names = EXERCISE_BY_CATEGORY.get(category)
  if (!names) return null

  // Tier 1: verbatim.
  if (names.has(suggestedName)) return suggestedName

  // Tier 2: normalised equality (drops case, underscores, punctuation).
  const targetNorm = normaliseEnum(suggestedName)
  for (const n of names) {
    if (normaliseEnum(n) === targetNorm) return n
  }

  // Tier 3: fuzzy token overlap with per-token edit-distance tolerance.
  const qTokens = tokenize(suggestedName)
  if (qTokens.length === 0) return null
  let best: string | null = null
  let bestScore = 0
  for (const n of names) {
    const cTokens = tokenize(n)
    if (cTokens.length === 0) continue
    let matched = 0
    for (const qt of qTokens) {
      if (cTokens.some(ct => tokensSimilar(qt, ct))) matched++
    }
    const score = matched / Math.max(qTokens.length, cTokens.length)
    if (score > bestScore) {
      bestScore = score
      best = n
    }
  }
  return bestScore >= 0.8 ? best : null
}

/**
 * Search the entire enum table for the closest exercise to a free-text label,
 * with no category hint. This is the deterministic fallback for when the LLM
 * volunteered no usable Garmin suggestion — coverage was otherwise
 * non-deterministic across re-parses (the same exercise resolved one run and
 * fell through the next, purely on the model's whim).
 *
 * Scoring mirrors `resolveEnumName`'s fuzzy tier: every label token must have an
 * exact or near-exact (edit-distance ≤ 1–2) counterpart in the candidate, scored
 * as matched / max(tokenCounts). The default 0.8 floor is deliberately strict —
 * it recovers the verbatim-but-unsuggested cases (e.g. "Dumbbell Floor Press" →
 * BENCH_PRESS/DUMBBELL_FLOOR_PRESS) while rejecting exercises Garmin simply
 * doesn't have (e.g. "Banded Pallof Press"). Returned pairs are always verbatim
 * enum members, so they are always safe to send.
 */
export function searchEnumByLabel(
  label: string | null | undefined,
  minScore = 0.8,
): { category: string; name: string; score: number } | null {
  if (!label) return null
  const qTokens = tokenize(label)
  if (qTokens.length === 0) return null
  let best: { category: string; name: string; score: number } | null = null
  for (const [category, names] of EXERCISE_BY_CATEGORY) {
    for (const n of names) {
      const cTokens = tokenize(n)
      if (cTokens.length === 0) continue
      let matched = 0
      for (const qt of qTokens) {
        if (cTokens.some(ct => tokensSimilar(qt, ct))) matched++
      }
      const score = matched / Math.max(qTokens.length, cTokens.length)
      if (!best || score > best.score) best = { category, name: n, score }
    }
  }
  return best && best.score >= minScore ? best : null
}

/** Strip case, separators, and punctuation for a forgiving equality compare. */
function normaliseEnum(s: string): string {
  let out = ''
  for (const ch of s.toUpperCase()) {
    if ((ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9')) out += ch
  }
  return out
}

/** Two tokens count as the same word if equal or within a length-scaled edit budget. */
function tokensSimilar(a: string, b: string): boolean {
  if (a === b) return true
  const longer = Math.max(a.length, b.length)
  if (longer < 5) return false // too short to risk a fuzzy collision (e.g. "leg" vs "led")
  const budget = longer >= 8 ? 2 : 1
  return levenshtein(a, b) <= budget
}

/** Classic iterative Levenshtein distance (no regex, O(a*b)). */
function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = new Array<number>(n + 1)
  let curr = new Array<number>(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[n]
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
