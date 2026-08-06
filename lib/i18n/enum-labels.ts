'use client'

import { useTranslations } from 'next-intl'

/** Title-case an unknown snake_case key as a safe fallback. */
function humanize(key: string): string {
  return key
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/**
 * Localized labels for fixed enum sets (workout_type, …). Falls back to a
 * humanized version of the raw key when a key isn't in the catalog, so
 * AI/template-generated values that fall outside the canonical set still
 * render sensibly instead of throwing a missing-message error.
 */
export function useEnumLabels() {
  const t = useTranslations('enums')
  return {
    workoutType: (type: string | null | undefined): string => {
      if (!type) return ''
      const key = `workoutType.${type}`
      return t.has(key) ? t(key) : humanize(type)
    },
    completionStatus: (status: string | null | undefined): string => {
      if (!status) return ''
      const key = `completionStatus.${status}`
      return t.has(key) ? t(key) : humanize(status)
    },
    // Intensity is not a closed set — methodology labels (E, T, R10, lactate_threshold)
    // come from the plan template — so the humanize fallback carries most of the load.
    // The catalog exists so the app's own vocabulary, above all the easy/recovery pair,
    // reads as intended words rather than raw enum keys.
    intensity: (intensity: string | null | undefined): string => {
      if (!intensity) return ''
      const key = `intensity.${intensity}`
      return t.has(key) ? t(key) : humanize(intensity)
    },
  }
}
