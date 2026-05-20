import { StrengthExerciseCatalog, StrengthExercise } from '@/types/database'

/**
 * Deterministic exercise → catalog resolver.
 *
 * The LLM is prompted to emit canonical_name in lower_snake_case, but we never
 * trust it. This mapper does the final lookup against the catalog and stamps
 * the authoritative `garmin_supported` flag plus the matched canonical/display
 * names. If no catalog entry matches, the exercise is preserved as-is with
 * garmin_supported = false and a reason explaining why.
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

  if (!hit) {
    return {
      ...llmExercise,
      garmin_supported: false,
      garmin_unsupported_reason: 'Exercise not in catalog',
    }
  }

  const supported = hit.garmin_supported
  return {
    ...llmExercise,
    canonical_name: hit.canonical_name,
    display_name: hit.display_name,
    garmin_supported: supported,
    garmin_unsupported_reason: supported ? undefined : 'Catalog entry missing Garmin IDs',
  }
}
