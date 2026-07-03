'use client'

import Link from 'next/link'
import { Info } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useIsDemo } from '@/lib/demo/use-is-demo'

/**
 * Persistent banner shown only in demo sessions, setting the expectation that the
 * account is a shared, nightly-reset sandbox. Renders nothing for real users.
 */
export function DemoBanner() {
  const isDemo = useIsDemo()
  const t = useTranslations('demo')
  if (!isDemo) return null

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-900 dark:text-amber-200">
      <span className="flex items-center gap-2">
        <Info className="h-4 w-4 shrink-0" />
        {t('bannerText')}
      </span>
      <Link href="/login" className="font-medium underline underline-offset-4">
        {t('bannerCta')}
      </Link>
    </div>
  )
}
