import { StrengthExerciseCatalog, StrengthExercise } from '@/types/database'
import { isKnownEnum } from '@/lib/garmin/exercise-enum'

/**
 * Deterministic exercise → catalog resolver.
 *
 * The LLM is prompted to emit canonical_name in lower_snake_case, but we never
 * trust it. This mapper does the final lookup against the catalog and stamps
 * the authoritative `garmin_supported` flag plus the matched canonical/display
 * names.
 *
 * Resolution order for the Garmin enum stamp:
 *   1. Catalog row with garmin_supported=true → stamp catalog enums.
 *   2. LLM-suggested enum with confidence='exact' AND verbatim-known in the
 *      canonical enum table → stamp LLM-suggested enums (lets new exercises
 *      sync to Garmin without expanding the curated catalog).
 *   3. Otherwise → garmin_supported=false with a reason.
 */

interface NormalisedLookup {
  byCanonical: Map<string, StrengthExerciseCatalog>
  byAlias: Map<string, StrengthExerciseCatalog>
}

export function buildCatalogLookup(catalog: StrengthExerciseCatalog[]): NormalisedLookup {
  const byCanonical = new Map<string, StrengthExerciseCatalog>()
  const byAlias = new Map<string, StrengthExerciseCatalog>()
  for (const row of catalog) {
    byCanonical.set(normalise(row.canonical_name), row)
    for (const alias of row.aliases ?? []) {
      byAlias.set(normalise(alias), row)
    }
  }
  return { byCanonical, byAlias }
}

function normalise(s: string): string {
  return s.trim().toLowerCase().replace(/[-\s]+/g, '_').replace(/[^a-z0-9_]/g, '')
}

export function resolveExerciseAgainstCatalog(
  llmExercise: StrengthExercise,
  lookup: NormalisedLookup,
): StrengthExercise {
  const candidates = [
    llmExercise.canonical_name,
    llmExercise.display_name,
    llmExercise.user_text,
  ]
  let hit: StrengthExerciseCatalog | undefined
  for (const c of candidates) {
    if (!c) continue
    const key = normalise(c)
    hit = lookup.byCanonical.get(key) ?? lookup.byAlias.get(key)
    if (hit) break
  }

  // Catalog hit with verified Garmin IDs — stamp catalog enums.
  if (hit && hit.garmin_supported && hit.garmin_exercise_category && hit.garmin_exercise_name) {
    return {
      ...llmExercise,
      canonical_name: hit.canonical_name,
      display_name: hit.display_name,
      garmin_supported: true,
      garmin_unsupported_reason: undefined,
      garmin_exercise_category: hit.garmin_exercise_category,
      garmin_exercise_name: hit.garmin_exercise_name,
      // Strip the LLM suggestion fields — catalog wins.
      garmin_suggested_category: undefined,
      garmin_suggested_name: undefined,
      garmin_suggested_confidence: undefined,
    }
  }

  // LLM suggested a Garmin enum and it's verbatim-known — trust it for this
  // session's exercise even if there's no catalog row (or the catalog row is
  // pending verification).
  const suggestedCategory = llmExercise.garmin_suggested_category
  const suggestedName = llmExercise.garmin_suggested_name
  const exact = llmExercise.garmin_suggested_confidence === 'exact'
  if (exact && isKnownEnum(suggestedCategory, suggestedName)) {
    return {
      ...llmExercise,
      canonical_name: hit?.canonical_name ?? llmExercise.canonical_name,
      display_name: hit?.display_name ?? llmExercise.display_name,
      garmin_supported: true,
      garmin_unsupported_reason: undefined,
      garmin_exercise_category: suggestedCategory!,
      garmin_exercise_name: suggestedName!,
      garmin_suggested_category: undefined,
      garmin_suggested_name: undefined,
      garmin_suggested_confidence: undefined,
    }
  }

  // No catalog hit at all.
  if (!hit) {
    return {
      ...llmExercise,
      garmin_supported: false,
      garmin_unsupported_reason: 'Exercise not in catalog',
      garmin_suggested_category: undefined,
      garmin_suggested_name: undefined,
      garmin_suggested_confidence: undefined,
    }
  }

  // Catalog hit, but enum still unverified (the catalog row hasn't been flipped yet).
  return {
    ...llmExercise,
    canonical_name: hit.canonical_name,
    display_name: hit.display_name,
    garmin_supported: false,
    garmin_unsupported_reason: 'Catalog entry missing Garmin IDs',
    garmin_suggested_category: undefined,
    garmin_suggested_name: undefined,
    garmin_suggested_confidence: undefined,
  }
}
