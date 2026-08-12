'use client'

import Link from 'next/link'
import { Info } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useIsDemo } from '@/lib/demo/use-is-demo'
import { useTourActive, TOUR_RESTART_EVENT } from '@/lib/demo/tour-state'

/**
 * Persistent banner shown only in demo sessions, setting the expectation that the
 * account is a shared, nightly-reset sandbox. Renders nothing for real users.
 *
 * Deliberately one line at every width: on a phone it sits directly above the page
 * title, so a wrapping three-line stack of links pushed the actual content down.
 * The message shortens instead of wrapping, and "Take the tour" is dropped while a
 * tour is already running.
 */
export function DemoBanner() {
  const isDemo = useIsDemo()
  const tourActive = useTourActive()
  const t = useTranslations('demo')
  if (!isDemo) return null

  // Green surface, but plain foreground text — black on light, white on dark.
  return (
    <div className="mb-4 flex items-center gap-2 rounded-md border border-green-600/40 bg-green-50 px-3 py-1.5 text-sm text-foreground dark:border-green-500/40 dark:bg-green-950/60">
      <Info className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        <span className="sm:hidden">{t('bannerTextShort')}</span>
        <span className="hidden sm:inline">{t('bannerText')}</span>
      </span>
      {!tourActive && (
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event(TOUR_RESTART_EVENT))}
          className="shrink-0 font-medium underline underline-offset-4"
        >
          {t('restartTour')}
        </button>
      )}
      <Button
        asChild
        size="sm"
        variant="outline"
        className="h-7 shrink-0 border-green-600/50 bg-transparent px-2.5 text-foreground hover:bg-green-100 hover:text-foreground dark:border-green-500/50 dark:hover:bg-green-900/40"
      >
        <Link href="/login">
          <span className="sm:hidden">{t('bannerCtaShort')}</span>
          <span className="hidden sm:inline">{t('bannerCta')}</span>
        </Link>
      </Button>
    </div>
  )
}
