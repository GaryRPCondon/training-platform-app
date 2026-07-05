'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase/client'

export default function QueryProvider({ children }: { children: React.ReactNode }) {
    const [queryClient] = useState(() => new QueryClient({
        defaultOptions: {
            queries: {
                staleTime: 60 * 1000, // 1 minute
                retry: 1,
            },
        },
    }))

    // Wipe the cache whenever the signed-in identity changes.
    //
    // The QueryClient is a long-lived singleton and auth transitions (login, the
    // demo button, logout) are soft client-side navigations — router.refresh()
    // only re-runs Server Components, it does NOT clear React Query. Without this,
    // the previous account's cached rows (e.g. the ['athlete'] row that drives the
    // demo banner via is_demo) leak into the next account until staleTime lapses
    // or the user hard-refreshes. Keyed on the user id so a mere token refresh
    // (same user) doesn't needlessly drop the cache.
    const lastUserId = useRef<string | null | undefined>(undefined)
    useEffect(() => {
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            const userId = session?.user?.id ?? null
            // First event (INITIAL_SESSION) just establishes the baseline.
            if (lastUserId.current === undefined) {
                lastUserId.current = userId
                return
            }
            if (userId !== lastUserId.current) {
                lastUserId.current = userId
                queryClient.clear()
            }
        })
        return () => subscription.unsubscribe()
    }, [queryClient])

    return (
        <QueryClientProvider client={queryClient}>
            {children}
        </QueryClientProvider>
    )
}
