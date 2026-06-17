import { cookies } from 'next/headers'
import { getRequestConfig } from 'next-intl/server'
import { defaultLocale, isLocale, LOCALE_COOKIE, type Locale } from './config'

/**
 * next-intl request config (no-i18n-routing mode).
 *
 * The active locale is carried in the `NEXT_LOCALE` cookie rather than the URL.
 * The cookie is written by the language selector (client) and hydrated from the
 * athlete's saved `locale` in `proxy.ts`, so a signed-in user gets their stored
 * preference on first paint without a URL segment.
 */
export default getRequestConfig(async () => {
  const cookieStore = await cookies()
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value
  const locale: Locale = isLocale(cookieLocale) ? cookieLocale : defaultLocale

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  }
})
