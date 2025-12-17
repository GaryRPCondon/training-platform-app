'use client'

import dynamic from 'next/dynamic'
import { Skeleton } from '@/components/ui/skeleton'

const TrainingCalendar = dynamic(
    () => import('@/components/calendar/training-calendar').then((mod) => mod.TrainingCalendar),
    {
        loading: () => <Skeleton className="h-[600px] w-full rounded-md" />,
        ssr: false // Calendar libraries often have issues with SSR
    }
)

export default function CalendarPage() {
    return (
        <div className="h-full flex flex-col overflow-hidden">
            <h1 className="text-3xl font-bold tracking-tight mb-6">Training Calendar</h1>

            {/* CRITICAL: React Big Calendar requires Grid layout with min-w-0 for proper width constraints.
                Flexbox alone causes the calendar to expand beyond viewport bounds (~1652px locked width).
                This pattern matches the working review page. DO NOT change to flex-1 min-h-0 only. */}
            <div className="flex-1 grid grid-cols-1 overflow-hidden">
                <div className="h-full w-full min-w-0">
                    <TrainingCalendar />
                </div>
            </div>
        </div>
    )
}
