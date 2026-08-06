/**
 * Pace Resolver — resolves methodology-specific intensity labels to numeric sec/km values.
 *
 * Templates define `pace_targets` mapping labels like "strength" or "lactate_threshold"
 * to athlete training paces with optional offsets. This module resolves those labels
 * against an athlete's actual paces (from VDOT) to produce concrete targets.
 */

import type { AllTrainingPaces } from '@/lib/training/vdot'
import { paceTargetsSchema, type PaceTarget } from '@/lib/templates/types'
import { formatClock } from '@/lib/utils/units'

// ============================================================================
// Types
// ============================================================================

export type { PaceTarget }

/**
 * Thrown when a template's pace_targets fails Zod validation. Carries the
 * template_id (when known) so seed-time and plan-generation callers can
 * point operators at the offending row.
 */
export class PaceTargetsValidationError extends Error {
  constructor(message: string, public readonly templateId?: string) {
    super(message)
    this.name = 'PaceTargetsValidationError'
  }
}

/**
 * Validate a template's pace_targets once before use. Throws on invalid input.
 * Call this at the seed boundary and at the start of plan generation; downstream
 * resolvePace calls then trust the input shape.
 */
export function validatePaceTargets(
  paceTargets: unknown,
  templateId?: string
): void {
  const result = paceTargetsSchema.safeParse(paceTargets ?? {})
  if (!result.success) {
    const issues = result.error.issues.map(issue => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '<root>'
      return `${path}: ${issue.message}`
    }).join('; ')
    const idPart = templateId ? ` (template ${templateId})` : ''
    throw new PaceTargetsValidationError(
      `Invalid pace_targets${idPart}: ${issues}`,
      templateId
    )
  }
}

export interface ResolvedPace {
  target_pace_sec_per_km: number
  target_pace_upper_sec_per_km: number | null  // slower bound for range targets
  pace_label: string                           // methodology label (e.g. "strength")
  pace_description: string                     // human-readable description
  pace_source: 'template' | 'athlete_override'
}

// ============================================================================
// Resolution
// ============================================================================

/**
 * Human-readable descriptions for the base VDOT paces, used when a label names a
 * training pace directly rather than a methodology target.
 */
const BASE_PACE_DESCRIPTIONS: Partial<Record<string, string>> = {
  easy: 'Conversational aerobic pace',
  recovery: 'Very easy — slower than easy pace, to speed recovery',
  marathon: 'Marathon race pace',
  tempo: 'Threshold / comfortably hard',
  interval: 'VO2max pace',
  repetition: 'Speed / repetition pace',
  // Deliberately no `walk`: a walk step gets no pace target unless a template asks for
  // one (see the walk short-circuit in lib/garmin/workout-mapper.ts).
}

/**
 * Resolve a methodology-specific intensity label to concrete pace values.
 *
 * Templates own the vocabulary, but the base VDOT paces are always available: a label
 * that names one directly (`recovery`, `easy`, …) resolves off the athlete's paces even
 * when the template never declared it. That is what lets the AI coach prescribe a
 * recovery run on a Daniels or Higdon plan, neither of which has a recovery label. A
 * template that DOES declare the label still wins — Hansons' recovery is easy + 15 s,
 * Pfitz's is easy + 10 s, and those offsets are the methodology's intent.
 *
 * @param intensityLabel - The intensity label from the LLM/template (e.g. "strength", "lactate_threshold")
 * @param paceTargets - The template's pace_targets mapping
 * @param athletePaces - The athlete's training + race paces from VDOT
 * @returns Resolved pace with numeric values, or null if the label resolves to nothing
 */
export function resolvePace(
  intensityLabel: string,
  paceTargets: Record<string, PaceTarget> | undefined,
  athletePaces: AllTrainingPaces
): ResolvedPace | null {
  if (!intensityLabel) return null

  const target = paceTargets?.[intensityLabel]
  if (!target) return resolveBasePace(intensityLabel, athletePaces)

  const basePace = lookupPace(target.reference_pace, athletePaces)
  if (basePace == null) return null

  const offset = target.offset_sec_per_km ?? 0
  const resolvedPace = basePace + offset

  let upperPace: number | null = null
  if (target.reference_pace_upper) {
    const upper = lookupPace(target.reference_pace_upper, athletePaces)
    if (upper != null) {
      upperPace = upper + offset
    }
  }

  return {
    target_pace_sec_per_km: Math.round(resolvedPace),
    target_pace_upper_sec_per_km: upperPace != null ? Math.round(upperPace) : null,
    pace_label: intensityLabel,
    pace_description: target.description,
    pace_source: 'template',
  }
}

/**
 * Resolve a label that names a base VDOT pace directly (no template target involved).
 * Returns null for anything that isn't one of the athlete's stored pace keys, so an
 * unknown methodology label still fails loudly rather than silently picking a pace.
 */
function resolveBasePace(
  intensityLabel: string,
  athletePaces: AllTrainingPaces
): ResolvedPace | null {
  const description = BASE_PACE_DESCRIPTIONS[intensityLabel]
  if (!description) return null

  const pace = lookupPace(intensityLabel, athletePaces)
  if (pace == null) return null

  return {
    target_pace_sec_per_km: Math.round(pace),
    target_pace_upper_sec_per_km: null,
    pace_label: intensityLabel,
    pace_description: description,
    pace_source: 'template',
  }
}

/**
 * Resolve all pace targets for a template against athlete paces.
 * Returns a map of label → resolved pace (useful for coach prompt methodology table).
 */
export function resolveAllPaces(
  paceTargets: Record<string, PaceTarget> | undefined,
  athletePaces: AllTrainingPaces
): Record<string, ResolvedPace> {
  if (!paceTargets) return {}

  const result: Record<string, ResolvedPace> = {}
  for (const [label, _target] of Object.entries(paceTargets)) {
    const resolved = resolvePace(label, paceTargets, athletePaces)
    if (resolved) {
      result[label] = resolved
    }
  }
  return result
}

// ============================================================================
// Formatting
// ============================================================================

/**
 * Format seconds/km as "M:SS" string (e.g. 253 → "4:13")
 */
export function formatPaceMinKm(secPerKm: number): string {
  return formatClock(secPerKm)
}

/**
 * Format a resolved pace for display: "4:13/km" or "4:13-4:25/km" for ranges
 */
export function formatResolvedPace(resolved: ResolvedPace, units: 'metric' | 'imperial' = 'metric'): string {
  const factor = units === 'imperial' ? 1.60934 : 1
  const unitLabel = units === 'imperial' ? '/mi' : '/km'

  const lower = formatPaceMinKm(resolved.target_pace_sec_per_km * factor)
  if (resolved.target_pace_upper_sec_per_km != null) {
    const upper = formatPaceMinKm(resolved.target_pace_upper_sec_per_km * factor)
    return `${lower}-${upper}${unitLabel}`
  }
  return `${lower}${unitLabel}`
}

// ============================================================================
// Helpers
// ============================================================================

function lookupPace(key: string, paces: AllTrainingPaces): number | null {
  const value = (paces as unknown as Record<string, unknown>)[key]
  return typeof value === 'number' ? value : null
}
