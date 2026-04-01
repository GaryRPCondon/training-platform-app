/**
 * Pace Resolver — resolves methodology-specific intensity labels to numeric sec/km values.
 *
 * Templates define `pace_targets` mapping labels like "strength" or "lactate_threshold"
 * to athlete training paces with optional offsets. This module resolves those labels
 * against an athlete's actual paces (from VDOT) to produce concrete targets.
 */

import type { AllTrainingPaces } from '@/lib/training/vdot'

// ============================================================================
// Types
// ============================================================================

export interface PaceTarget {
  reference_pace: string           // key into AllTrainingPaces (e.g. "easy", "race_5k")
  offset_sec_per_km?: number       // negative=faster, positive=slower. Default 0
  reference_pace_upper?: string    // for range targets (e.g. Pfitz LT: race_15k → race_half_marathon)
  description: string              // human-readable, shown in coach prompt
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
 * Resolve a methodology-specific intensity label to concrete pace values.
 *
 * @param intensityLabel - The intensity label from the LLM/template (e.g. "strength", "lactate_threshold")
 * @param paceTargets - The template's pace_targets mapping
 * @param athletePaces - The athlete's training + race paces from VDOT
 * @returns Resolved pace with numeric values, or null if label not found in targets
 */
export function resolvePace(
  intensityLabel: string,
  paceTargets: Record<string, PaceTarget> | undefined,
  athletePaces: AllTrainingPaces
): ResolvedPace | null {
  if (!paceTargets || !intensityLabel) return null

  const target = paceTargets[intensityLabel]
  if (!target) return null

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
  const minutes = Math.floor(secPerKm / 60)
  const seconds = Math.round(secPerKm % 60)
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
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
