'use client'

import { useEffect, useState } from 'react'

/**
 * Shared tour state, so the demo banner and the tour bar agree on whether a tour
 * is currently running. The tour bar owns the storage; this module is the contract
 * between the two (the banner hides its "Take the tour" link while one is active —
 * offering to start a tour you are already on just costs a line of the banner).
 */

export const TOUR_STORAGE_KEY = 'demo_tour_v1'

// Fired by the tour bar after every write, so listeners re-read rather than poll.
// (The native `storage` event only fires in *other* tabs, which is not the case here.)
export const TOUR_STATE_EVENT = 'demo:tour-state'

// Fired by the banner to (re)start the tour; the tour bar listens.
export const TOUR_RESTART_EVENT = 'demo:tour-restart'

/**
 * True while the tour bar is showing. A visitor who has never touched the tour has
 * no stored state and sees it from step 0, so "no record" counts as active.
 * False during SSR and the first client render, matching the bar's own hydration gate.
 */
export function useTourActive(): boolean {
  const [active, setActive] = useState(false)

  useEffect(() => {
    const read = () => {
      try {
        const raw = localStorage.getItem(TOUR_STORAGE_KEY)
        if (!raw) return setActive(true)
        const saved = JSON.parse(raw) as { dismissed?: boolean }
        setActive(!saved.dismissed)
      } catch {
        setActive(true)
      }
    }
    read()
    window.addEventListener(TOUR_STATE_EVENT, read)
    return () => window.removeEventListener(TOUR_STATE_EVENT, read)
  }, [])

  return active
}
