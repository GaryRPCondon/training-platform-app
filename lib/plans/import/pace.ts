import type { AllTrainingPaces } from '@/lib/training/vdot'
import { intensityToPaceKey, RunIntensity } from '@/lib/plans/import/intensity'

const METERS_PER_MILE = 1609.34

/**
 * Parse an explicit clock pace from a source plan into seconds-per-km.
 * Accepts forms like "4:30/km", "4:30 km", "7:15/mi", "7:15 per mile".
 * Returns null when it can't be parsed confidently (caller falls back to VDOT).
 *
 * Deliberately regex-free (per project convention: no regex in runtime logic) —
 * parsed with split/trim only.
 */
export function parsePaceLiteral(raw: string | null | undefined): number | null {
  if (!raw) return null
  const s = raw.trim().toLowerCase()
  if (s.length === 0) return null

  const isMile = s.includes('mi') || s.includes('mile')

  // Take the clock portion: everything up to the first '/' or space-unit.
  // Split on '/' first; otherwise take the first whitespace token.
  let clock = s
  const slash = s.indexOf('/')
  if (slash >= 0) {
    clock = s.slice(0, slash)
  } else {
    clock = s.split(' ')[0]
  }
  clock = clock.trim()

  const parts = clock.split(':')
  if (parts.length !== 2) return null
  const mins = Number(parts[0])
  const secs = Number(parts[1])
  if (!Number.isFinite(mins) || !Number.isFinite(secs)) return null
  if (mins < 0 || secs < 0 || secs >= 60) return null

  const totalSecondsPerUnit = mins * 60 + secs
  if (totalSecondsPerUnit <= 0) return null

  // Convert per-mile to per-km when the unit was miles.
  const secPerKm = isMile ? totalSecondsPerUnit / (METERS_PER_MILE / 1000) : totalSecondsPerUnit
  return Math.round(secPerKm)
}

export interface ResolvedImportPace {
  target_pace_sec_per_km: number
  pace_label: string
  pace_source: 'literal' | 'vdot'
}

/**
 * Resolve a workout's target pace: prefer an explicit literal pace from the
 * source; otherwise map the canonical intensity onto the athlete's VDOT paces.
 * Returns null when neither is available (qualitative-only plan with no VDOT) —
 * the workout then carries no concrete target, which is acceptable.
 */
export function resolveImportPace(
  intensity: RunIntensity | null | undefined,
  paceLiteral: string | null | undefined,
  athletePaces: AllTrainingPaces | null | undefined,
): ResolvedImportPace | null {
  const literal = parsePaceLiteral(paceLiteral)
  if (literal != null) {
    return { target_pace_sec_per_km: literal, pace_label: intensity ?? 'literal', pace_source: 'literal' }
  }

  if (!intensity || !athletePaces) return null
  const key = intensityToPaceKey(intensity)
  const value = athletePaces[key]
  if (typeof value !== 'number') return null
  return { target_pace_sec_per_km: value, pace_label: intensity, pace_source: 'vdot' }
}
