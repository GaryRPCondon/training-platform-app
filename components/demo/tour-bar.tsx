'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, X, Compass } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useIsDemo } from '@/lib/demo/use-is-demo'
import { useMediaQuery } from '@/lib/hooks/use-media-query'
import { cn } from '@/lib/utils'
import { TOUR_STORAGE_KEY, TOUR_STATE_EVENT, TOUR_RESTART_EVENT } from '@/lib/demo/tour-state'

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

  // On mobile the bar is pinned to the bottom of the viewport instead of sitting in
  // the page flow: several stops auto-open a detail card that fills a phone screen,
  // and an in-flow bar disappears behind it (see the non-modal dialogs on the
  // calendar, which keep this bar clickable).
  const isMobile = useMediaQuery('(max-width: 767px)')
  const barRef = useRef<HTMLDivElement | null>(null)

  // Read saved progress once on mount (avoids a flash before we know state).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(TOUR_STORAGE_KEY)
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
    window.addEventListener(TOUR_RESTART_EVENT, restart)
    return () => window.removeEventListener(TOUR_RESTART_EVENT, restart)
  }, [router])

  // Persist progress, then tell the banner so it can drop its "Take the tour" link
  // for as long as a tour is running.
  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(TOUR_STORAGE_KEY, JSON.stringify({ step, dismissed }))
    } catch {
      // ignore write failures (private mode etc.)
    }
    window.dispatchEvent(new Event(TOUR_STATE_EVENT))
  }, [step, dismissed, hydrated])

  // A pinned bar covers the end of the page, so reserve its height at the bottom of
  // <main>. Re-measured on resize because the body copy's height varies by stop.
  // The same height is published as `--tour-bar-h` so the cards the tour opens can
  // shrink into the space above the bar instead of hiding behind it.
  useEffect(() => {
    const main = document.getElementById('main-content')
    const bar = barRef.current
    const clear = () => {
      if (main) main.style.paddingBottom = ''
      document.documentElement.style.removeProperty('--tour-bar-h')
    }
    if (!main) return
    if (!isMobile || !bar) {
      clear()
      return
    }
    const apply = () => {
      const height = `${bar.offsetHeight}px`
      main.style.paddingBottom = height
      document.documentElement.style.setProperty('--tour-bar-h', height)
    }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(bar)
    return () => {
      observer.disconnect()
      clear()
    }
  }, [isMobile, isDemo, dismissed, hydrated, step])

  if (!isDemo || dismissed || !hydrated) return null

  const stop = STOPS[step]
  const isFirst = step === 0
  const isLast = step === STOPS.length - 1

  const goTo = (index: number) => {
    setStep(index)
    router.push(STOPS[index].nav)
  }

  return (
    <div
      ref={barRef}
      className={cn(
        'border border-primary/30 bg-primary/5 px-4 py-3',
        isMobile
          // z-60 clears the dialog layer (z-50). The surface MUST be a plain solid
          // colour: page content scrolls underneath, so any transparency makes two
          // sets of text overlap. `bg-muted` is the one token that is solid AND
          // distinct from the page in both themes (light 0.968 vs a white page, dark
          // 0.279 vs 0.129) — `bg-card` matches the page exactly in light mode.
          // Do NOT reintroduce a gradient here: twMerge treats `bg-gradient-*` as a
          // background conflict and silently drops the background colour, which is
          // how this shipped see-through once already.
          ? 'fixed inset-x-0 bottom-0 z-[60] rounded-t-xl bg-muted border-x-0 border-b-0 border-t-2 border-primary/60 shadow-[0_-6px_24px_rgb(0,0,0,0.20)] dark:shadow-[0_-8px_28px_rgb(0,0,0,0.7)] pb-[max(0.75rem,env(safe-area-inset-bottom))]'
          : 'mb-4 rounded-md'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <Compass className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0 space-y-1">
            {/* On mobile the counter becomes a filled pill — the same badge idiom as
                the calendar's TODAY marker — so the tour reads as a distinct thing
                rather than more page copy. */}
            <p
              className={cn(
                'text-xs font-medium uppercase tracking-wide',
                isMobile
                  ? 'inline-block rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground'
                  : 'text-muted-foreground'
              )}
            >
              {t('stepCounter', { current: step + 1, total: STOPS.length })}
            </p>
            <p className={cn('text-sm font-semibold', isMobile && 'text-base')}>{t(`${stop.key}Title`)}</p>
            {/* Capped + scrollable on mobile so a long stop can't eat the screen.
                Full-strength foreground there too — muted-foreground on the muted
                surface is what made the guide text recede into the page. */}
            <p className={cn('text-sm text-muted-foreground', isMobile && 'max-h-[28dvh] overflow-y-auto text-foreground')}>
              {t(`${stop.key}Body`)}
            </p>
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
