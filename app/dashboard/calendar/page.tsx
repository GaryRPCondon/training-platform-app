'use client'

import { Suspense } from 'react'
import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'
import { Skeleton } from '@/components/ui/skeleton'

const TrainingCalendar = dynamic(
    () => import('@/components/calendar/training-calendar').then((mod) => mod.TrainingCalendar),
    {
        loading: () => <Skeleton className="h-[600px] w-full rounded-md" />,
        ssr: false // Calendar libraries often have issues with SSR
    }
)

function CalendarContent() {
    const searchParams = useSearchParams()
    const openWorkoutId = searchParams.get('workoutId')
        ? Number(searchParams.get('workoutId'))
        : undefined

    return (
        <div className="flex flex-col h-full md:overflow-hidden min-h-screen md:min-h-0">
            <h1 className="text-3xl font-bold tracking-tight mb-6">Training Calendar</h1>

            {/* CRITICAL: React Big Calendar requires Grid layout with min-w-0 for proper width constraints.
                Flexbox alone causes the calendar to expand beyond viewport bounds (~1652px locked width).
                This pattern matches the working review page. DO NOT change to flex-1 min-h-0 only. */}
            <div className="flex-1 grid grid-cols-1 overflow-visible md:overflow-hidden">
                <div className="h-full w-full min-w-0">
                    <TrainingCalendar openWorkoutId={openWorkoutId} />
                </div>
            </div>
        </div>
    )
}

export default function CalendarPage() {
    return (
        <Suspense fallback={<Skeleton className="h-[600px] w-full rounded-md" />}>
            <CalendarContent />
        </Suspense>
    )
}
