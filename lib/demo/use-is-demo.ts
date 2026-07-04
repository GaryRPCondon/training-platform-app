'use client'

import { useQuery } from '@tanstack/react-query'
import { getAthleteProfile } from '@/lib/supabase/queries'
import { queryKeys } from '@/lib/query-keys'

/**
 * Client hook: true when the signed-in athlete is the shared demo account.
 *
 * Reads the `is_demo` flag from the existing ['athlete'] React Query cache
 * (populated by getAthleteProfile()), so it adds no extra fetch. Used to render
 * demo-mode banners/notices and to present blocked features as intentional.
 *
 * This is a UX signal only — real enforcement is server-side (isDemoUser() in
 * lib/demo/demo.ts plus the proxy and route guards). Defaults to false while the
 * athlete query is still loading.
 */
export function useIsDemo(): boolean {
  const { data: athlete } = useQuery({
    queryKey: queryKeys.athlete(),
    queryFn: getAthleteProfile,
  })
  return athlete?.is_demo ?? false
}
