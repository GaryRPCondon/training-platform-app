'use client'

import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { format, subDays } from 'date-fns'
import { getAthleteProfile } from '@/lib/supabase/queries'

export function AutoSync() {
    const triggered = useRef(false)
    const queryClient = useQueryClient()

    const { data: athlete } = useQuery({
        queryKey: ['athlete'],
        queryFn: getAthleteProfile
    })

    useEffect(() => {
        if (!athlete || triggered.current) return
        if (!athlete.sync_on_login) return
        if (!athlete.garmin_connected && !athlete.strava_connected) return

        // Only sync once per browser session
        const alreadySynced = sessionStorage.getItem('auto_sync_done')
        if (alreadySynced) return

        triggered.current = true
        sessionStorage.setItem('auto_sync_done', Date.now().toString())

        const syncPlatforms = async () => {
            const platforms: string[] = []
            if (athlete.garmin_connected) platforms.push('garmin')
            if (athlete.strava_connected) platforms.push('strava')

            toast.info(`Syncing recent activities from ${platforms.join(' & ')}...`)

            try {
                // Run syncs sequentially (Strava after Garmin) to avoid race conditions in dedup
                if (athlete.garmin_connected) {
                    await fetch('/api/sync/garmin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
                }
                if (athlete.strava_connected) {
                    await fetch('/api/sync/strava', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
                }
                // Auto-match synced activities to planned workouts
                const today = new Date()
                const weekAgo = subDays(today, 7)
                const matchRes = await fetch('/api/activities/match', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ startDate: format(weekAgo, 'yyyy-MM-dd'), endDate: format(today, 'yyyy-MM-dd') })
                })
                const matchData = await matchRes.json()

                // Refresh calendar/dashboard data so new activities appear immediately
                queryClient.invalidateQueries({ queryKey: ['activities'] })
                queryClient.invalidateQueries({ queryKey: ['workouts'] })
                const matchMsg = matchData.matchCount ? ` (${matchData.matchCount} matched to workouts)` : ''
                toast.success(`Activities synced${matchMsg}`)
            } catch {
                // Silently fail - user can always manually sync
            }
        }

        syncPlatforms()
    }, [athlete, queryClient])

    return null
}
