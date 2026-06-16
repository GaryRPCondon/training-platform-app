import { StrengthExerciseCatalog, StrengthExercise } from '@/types/database'
import { resolveEnumName, searchEnumByLabel } from '@/lib/garmin/exercise-enum'

/**
 * Deterministic exercise → catalog resolver.
 *
 * The LLM is prompted to emit canonical_name in lower_snake_case, but we never
 * trust it. This mapper does the final lookup against the catalog and stamps
 * the authoritative `garmin_supported` flag plus the matched canonical/display
 * names.
 *
 * Resolution order for the Garmin enum stamp:
 *   1. Catalog row with garmin_supported=true → stamp catalog enums (exact).
 *   2. LLM-suggested enum (confidence 'exact' OR 'partial') that resolves to a
 *      real Garmin enum string → stamp it. The suggested name is run through
 *      `resolveEnumName`, which tolerates Garmin's spelling/token noise, so a
 *      correct-but-mis-typed suggestion still lands. Quality is 'exact' only
 *      when the model was confident AND its name was verbatim-correct; anything
 *      that needed the partial tier or a fuzzy correction is 'approximate' and
 *      surfaced to the user for a sanity check.
 *   3. Deterministic name search (`searchEnumByLabel`) — when the LLM gave no
 *      usable suggestion, search the whole enum by the exercise's own label.
 *      Removes the dependence on the model volunteering a mapping (coverage was
 *      non-deterministic across re-parses otherwise). Always 'approximate'.
 *   4. Otherwise → garmin_supported=false with a reason.
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
      garmin_match_quality: 'exact',
      // Strip the LLM suggestion fields — catalog wins.
      garmin_suggested_category: undefined,
      garmin_suggested_name: undefined,
      garmin_suggested_confidence: undefined,
    }
  }

  // LLM suggested a Garmin enum — accept exact OR partial confidence and resolve
  // the name against the live enum (tolerating spelling/token noise). This lets
  // an exercise sync to Garmin without a curated catalog row, and recovers the
  // large class of variant exercises ("split squat", "single-leg glute bridge")
  // the model can only place at family-level confidence.
  const suggestedCategory = llmExercise.garmin_suggested_category
  const suggestedName = llmExercise.garmin_suggested_name
  const confidence = llmExercise.garmin_suggested_confidence
  if ((confidence === 'exact' || confidence === 'partial') && suggestedCategory) {
    const resolvedName = resolveEnumName(suggestedCategory, suggestedName)
    if (resolvedName) {
      // 'exact' only when the model was confident AND nailed the verbatim string.
      // A partial suggestion, or one that needed a fuzzy correction, is approximate.
      const isExact = confidence === 'exact' && resolvedName === suggestedName
      return {
        ...llmExercise,
        canonical_name: hit?.canonical_name ?? llmExercise.canonical_name,
        display_name: hit?.display_name ?? llmExercise.display_name,
        garmin_supported: true,
        garmin_unsupported_reason: undefined,
        garmin_exercise_category: suggestedCategory,
        garmin_exercise_name: resolvedName,
        garmin_match_quality: isExact ? 'exact' : 'approximate',
        garmin_suggested_category: undefined,
        garmin_suggested_name: undefined,
        garmin_suggested_confidence: undefined,
      }
    }
  }

  // No catalog hit at all — try a deterministic name search before giving up.
  // This runs when the LLM volunteered no usable suggestion, searching the whole
  // enum by the exercise's own label so coverage no longer depends on the model
  // emitting a mapping (it was non-deterministic across re-parses otherwise).
  // Try the display_name first, then the raw canonical_name. A hit is always
  // flagged approximate. Conservative ≥0.8 floor: recovers verbatim-but-
  // unsuggested exercises, rejects ones Garmin genuinely lacks.
  //
  // Scoped to the no-catalog-row case on purpose: a catalog row explicitly
  // flagged unsupported is curated state, and overriding stale placeholders is a
  // separate catalog-cleanup concern — not something a fuzzy search should do.
  if (!hit) {
    const labelMatch =
      searchEnumByLabel(llmExercise.display_name) ??
      searchEnumByLabel(llmExercise.canonical_name)
    if (labelMatch) {
      return {
        ...llmExercise,
        garmin_supported: true,
        garmin_unsupported_reason: undefined,
        garmin_exercise_category: labelMatch.category,
        garmin_exercise_name: labelMatch.name,
        garmin_match_quality: 'approximate',
        garmin_suggested_category: undefined,
        garmin_suggested_name: undefined,
        garmin_suggested_confidence: undefined,
      }
    }
    return {
      ...llmExercise,
      garmin_supported: false,
      garmin_unsupported_reason: 'Exercise not in catalog',
      garmin_match_quality: undefined,
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
    garmin_match_quality: undefined,
    garmin_suggested_category: undefined,
    garmin_suggested_name: undefined,
    garmin_suggested_confidence: undefined,
  }
}
