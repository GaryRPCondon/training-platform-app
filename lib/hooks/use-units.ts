'use client'

import { useQuery } from '@tanstack/react-query'
import { getAthleteProfile } from '@/lib/supabase/queries'
import {
  formatDistance,
  formatPace,
  formatElevation,
  toDisplayDistance,
  toDisplayElevation,
  distanceLabel,
  paceLabel,
  elevationLabel,
  type UnitSystem,
} from '@/lib/utils/units'

/**
 * Hook that returns unit-aware formatting functions bound to the athlete's preference.
 *
 * Reads `preferred_units` from the existing ['athlete'] React Query cache
 * (already populated by getAthleteProfile() in many components).
 */
export function useUnits() {
  const { data: athlete } = useQuery({
    queryKey: ['athlete'],
    queryFn: getAthleteProfile,
  })

  const units: UnitSystem = athlete?.preferred_units ?? 'metric'

  return {
    units,
    formatDistance: (meters: number, decimals?: number) => formatDistance(meters, units, decimals),
    formatPace: (secsPerKm: number) => formatPace(secsPerKm, units),
    formatElevation: (meters: number) => formatElevation(meters, units),
    toDisplayDistance: (meters: number) => toDisplayDistance(meters, units),
    toDisplayElevation: (meters: number) => toDisplayElevation(meters, units),
    distanceLabel: () => distanceLabel(units),
    paceLabel: () => paceLabel(units),
    elevationLabel: () => elevationLabel(units),
  }
}
