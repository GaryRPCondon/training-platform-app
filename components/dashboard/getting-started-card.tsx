'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Circle, ArrowRight, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useIsDemo } from '@/lib/demo/use-is-demo'

/**
 * Onboarding checklist shown to invited (real) users on the dashboard until every
 * step is complete or they dismiss it. Steps are derived from real account state
 * passed in as props — there is no separate tracking, so they self-complete as the
 * user connects an integration, syncs, builds a plan, etc. Hidden for the demo
 * account (which is already fully populated) via useIsDemo(). Dismissal lives in
 * localStorage since the steps are self-completing and losing the flag is harmless.
 */

export interface GettingStartedState {
  hasIntegration: boolean
  hasActivities: boolean
  hasPlan: boolean
  hasActivePlan: boolean
  hasChat: boolean
}

const STORAGE_KEY = 'getting_started_dismissed_v1'

export function GettingStartedCard({ state }: { state: GettingStartedState }) {
  const isDemo = useIsDemo()
  const t = useTranslations('gettingStarted')
  const [dismissed, setDismissed] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY)) setDismissed(true)
    } catch {
      // ignore unavailable storage
    }
    setHydrated(true)
  }, [])

  const steps = [
    { key: 'connect', href: '/dashboard/profile', done: state.hasIntegration },
    { key: 'sync', href: '/dashboard/sync', done: state.hasActivities },
    { key: 'plan', href: '/dashboard/plans', done: state.hasPlan },
    { key: 'activate', href: '/dashboard/plans', done: state.hasActivePlan },
    { key: 'coach', href: '/dashboard/chat', done: state.hasChat },
  ] as const

  const doneCount = steps.filter((s) => s.done).length
  const allDone = doneCount === steps.length

  // Wait for hydration (avoids a flash + SSR/client mismatch on the localStorage
  // read), and never show for the demo account or once everything is complete.
  if (!hydrated || isDemo || dismissed || allDone) return null

  const dismiss = () => {
    setDismissed(true)
    try {
      localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      // ignore write failures (private mode etc.)
    }
  }

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-base">{t('title')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('progress', { done: doneCount, total: steps.length })}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          aria-label={t('dismiss')}
          onClick={dismiss}
        >
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-1">
        {steps.map((step) => {
          const title = t(`${step.key}Title`)
          const desc = t(`${step.key}Desc`)
          if (step.done) {
            return (
              <div key={step.key} className="flex items-center gap-3 rounded-md px-2 py-2">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
                <span className="text-sm text-muted-foreground line-through">{title}</span>
              </div>
            )
          }
          return (
            <Link
              key={step.key}
              href={step.href}
              className="group flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-primary/10"
            >
              <Circle className="h-5 w-5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{title}</span>
                <span className="block text-xs text-muted-foreground">{desc}</span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </Link>
          )
        })}
      </CardContent>
    </Card>
  )
}
