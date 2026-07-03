'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, X, Compass } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useIsDemo } from '@/lib/demo/use-is-demo'

/**
 * Guided "tour bar" shown only in demo sessions. It walks a visitor across the
 * populated screens with a one-paragraph pitch per stop and Next/Back buttons
 * that navigate for them. Progress + dismissal live in localStorage so they
 * survive the shared account and page reloads. No external tour dependency.
 */

// Each stop has a `nav` (where Next/Back navigates) and its i18n copy keys
// ({key}Title / {key}Body). Several stops share the /dashboard/calendar path but
// carry a distinct ?tour= query so the calendar auto-opens the right card and so
// the sync-to-location logic below can still tell them apart.
const STOPS = [
  { nav: '/dashboard', key: 'dashboard' },
  { nav: '/dashboard/calendar', key: 'calendar' },
  { nav: '/dashboard/calendar?tour=workout', key: 'runningWorkout' },
  { nav: '/dashboard/calendar?tour=activity', key: 'completedActivity' },
  { nav: '/dashboard/calendar?tour=strength', key: 'strengthWorkout' },
  { nav: '/dashboard/activities', key: 'activities' },
  { nav: '/dashboard/sync', key: 'activitySync' },
  { nav: '/dashboard/plans', key: 'plans' },
  { nav: '/dashboard/plans/new', key: 'schedulePlan' },
  { nav: '/dashboard/plans/import', key: 'importPlan' },
  { nav: '/dashboard/strength', key: 'strength' },
  { nav: '/dashboard/strength/import', key: 'importStrength' },
  { nav: '/dashboard/profile', key: 'profile' },
  { nav: '/dashboard/chat', key: 'coach' },
] as const

const STORAGE_KEY = 'demo_tour_v1'

export function TourBar() {
  const isDemo = useIsDemo()
  const t = useTranslations('demoTour')
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const search = searchParams.toString()
  const currentHref = search ? `${pathname}?${search}` : pathname

  const [step, setStep] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  // Read saved progress once on mount (avoids a flash before we know state).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const saved = JSON.parse(raw) as { step?: number; dismissed?: boolean }
        if (typeof saved.step === 'number') setStep(Math.min(Math.max(saved.step, 0), STOPS.length - 1))
        if (saved.dismissed) setDismissed(true)
      }
    } catch {
      // ignore corrupt storage
    }
    setHydrated(true)
  }, [])

  // Keep the current stop in sync with the location. Matching on the full href
  // (path + query) distinguishes the several /dashboard/calendar card stops, and
  // a plain manual nav (no ?tour=) still resolves to the calendar overview stop.
  useEffect(() => {
    const idx = STOPS.findIndex(s => s.nav === currentHref)
    if (idx >= 0) setStep(idx)
  }, [currentHref])

  // Re-activate when the demo banner's "Take the tour" button fires. The component
  // stays mounted while dismissed (it just renders null), so this listener is live.
  useEffect(() => {
    const restart = () => {
      setDismissed(false)
      setStep(0)
      router.push(STOPS[0].nav)
    }
    window.addEventListener('demo:tour-restart', restart)
    return () => window.removeEventListener('demo:tour-restart', restart)
  }, [router])

  // Persist progress.
  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ step, dismissed }))
    } catch {
      // ignore write failures (private mode etc.)
    }
  }, [step, dismissed, hydrated])

  if (!isDemo || dismissed || !hydrated) return null

  const stop = STOPS[step]
  const isFirst = step === 0
  const isLast = step === STOPS.length - 1

  const goTo = (index: number) => {
    setStep(index)
    router.push(STOPS[index].nav)
  }

  return (
    <div className="mb-4 rounded-md border border-primary/30 bg-primary/5 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <Compass className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('stepCounter', { current: step + 1, total: STOPS.length })}
            </p>
            <p className="text-sm font-semibold">{t(`${stop.key}Title`)}</p>
            <p className="text-sm text-muted-foreground">{t(`${stop.key}Body`)}</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          aria-label={t('dismiss')}
          onClick={() => setDismissed(true)}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="mt-3 flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" className="gap-1" disabled={isFirst} onClick={() => goTo(step - 1)}>
          <ChevronLeft className="h-4 w-4" />
          {t('back')}
        </Button>
        {isLast ? (
          <Button size="sm" asChild>
            <Link href="/login">{t('finishCta')}</Link>
          </Button>
        ) : (
          <Button size="sm" className="gap-1" onClick={() => goTo(step + 1)}>
            {t('next')}
            <ChevronRight className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  )
}
