/**
 * Canonical running-intensity vocabulary for imported plans.
 *
 * Book/app plans express effort qualitatively far more often than as clock
 * paces ("general aerobic", "marathon race pace", "VO2max", "5K pace",
 * "strides"). The parser/normalizer maps whatever the source says onto one of
 * these canonical tokens; at materialize time (Phase B) each token resolves to
 * a concrete sec/km target via the athlete's VDOT paces (lib/training/vdot.ts).
 *
 * Tokens deliberately collapse onto the VDOT TrainingPaces keys
 * (easy/recovery/marathon/tempo/interval/repetition) so resolution reuses existing
 * math rather than introducing a parallel pace model.
 */

import { resolveIntensityPaceKey, type TrainingPaces } from '@/lib/training/vdot'

export const RUN_INTENSITIES = [
  'recovery',
  'easy',
  'long',
  'marathon_pace',
  'threshold',
  'vo2max',
  'rep',
  'strides',
  'race',
] as const

export type RunIntensity = (typeof RUN_INTENSITIES)[number]

/**
 * Map a canonical intensity token to the VDOT pace key used for resolution.
 * 'race' resolves to marathon as a last resort; presentation callers should
 * special-case race day before reaching here (mirrors getWorkoutPaceType).
 *
 * Delegates to the shared resolver so imported plans and generated plans agree on
 * what a label means. A parity test pins every RUN_INTENSITIES token to its key,
 * which is what the exhaustive switch here used to buy.
 */
export function intensityToPaceKey(intensity: RunIntensity): keyof TrainingPaces {
  return resolveIntensityPaceKey(intensity)
}

/**
 * Best-effort mapping of free-text intensity/pace phrasing onto a canonical
 * token. Returns null when nothing matches confidently — the caller keeps the
 * verbatim text and emits a parse warning rather than guessing (per the
 * no-fallbacks principle: don't invent pace data).
 *
 * Substring matching over a normalized lower-case string. Order matters: more
 * specific phrases are tested before broader ones.
 */
export function mapTextToIntensity(raw: string): RunIntensity | null {
  const t = raw.toLowerCase()

  // Speed / reps / strides
  if (t.includes('stride')) return 'strides'
  if (t.includes('rep ') || t.includes('repetition') || /\b3k\b/.test(t) || t.includes('1500')) return 'rep'

  // VO2max / interval / 5k
  if (t.includes('vo2') || t.includes('v̇o2') || t.includes('interval') || /\b5k\b/.test(t)) return 'vo2max'

  // Threshold / tempo / LT / 10k-15k-HM efforts
  if (
    t.includes('threshold') ||
    t.includes('tempo') ||
    t.includes('lactate') ||
    /\blt\b/.test(t) ||
    /\b10k\b/.test(t) ||
    /\b15k\b/.test(t) ||
    t.includes('half marathon') ||
    t.includes('half-marathon')
  ) {
    return 'threshold'
  }

  // Marathon pace
  if (t.includes('marathon')) return 'marathon_pace'

  // Recovery vs easy/aerobic
  if (t.includes('recovery')) return 'recovery'
  if (t.includes('long')) return 'long'
  if (t.includes('easy') || t.includes('general aerobic') || t.includes('aerobic') || t.includes('steady')) {
    return 'easy'
  }

  return null
}

function isRunIntensity(v: string): v is RunIntensity {
  return (RUN_INTENSITIES as readonly string[]).includes(v)
}

/**
 * Normalize an intensity field that may already be a canonical token, an alias,
 * or free text. Returns null if it can't be confidently classified.
 */
export function normalizeIntensity(raw: string | null | undefined): RunIntensity | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (isRunIntensity(trimmed)) return trimmed
  return mapTextToIntensity(trimmed)
}
