/**
 * Central i18n configuration — the single source of truth for which locales the
 * app supports, their display labels, and text direction.
 *
 * Runtime locale resolution lives in `i18n/request.ts`; this file holds only the
 * static metadata that both the server (request config, <html> attrs) and the
 * client (language selector) need to agree on.
 */

/**
 * Supported locales.
 * - `en`    — canonical English (the authored source catalog).
 * - `en-XA` — accented LTR pseudo-locale (verification: surfaces un-extracted
 *             strings + truncation). Dev/QA only.
 * - `en-XB` — bidi RTL pseudo-locale (verification: surfaces layout that doesn't
 *             mirror under `dir="rtl"`). Dev/QA only.
 */
export const locales = ['en', 'en-XA', 'en-XB'] as const

export type Locale = (typeof locales)[number]

export const defaultLocale: Locale = 'en'

/** Human-readable labels shown in the language selector. */
export const localeLabels: Record<Locale, string> = {
  en: 'English',
  'en-XA': 'Pseudo (accented)',
  'en-XB': 'Pseudo (RTL)',
}

const RTL_PREFIXES = ['ar', 'he', 'fa', 'ur'] as const

/**
 * Text direction for a locale. Real RTL languages are matched by language
 * subtag; the `*-XB` pseudo-locale is forced RTL so the layout can be tested
 * without shipping a real RTL translation.
 */
export function getLocaleDir(locale: string): 'ltr' | 'rtl' {
  if (locale.endsWith('-XB')) return 'rtl'
  const lang = locale.toLowerCase().split('-')[0]
  return (RTL_PREFIXES as readonly string[]).includes(lang) ? 'rtl' : 'ltr'
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value)
}

/** Cookie that carries the resolved locale to the server on each request. */
export const LOCALE_COOKIE = 'NEXT_LOCALE'
