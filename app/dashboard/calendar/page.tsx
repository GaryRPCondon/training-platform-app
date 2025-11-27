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
        <div className="space-y-6 h-full flex flex-col">
            <h1 className="text-3xl font-bold tracking-tight">Training Calendar</h1>
            <div className="flex-1 min-h-[600px]">
                <TrainingCalendar />
            </div>
        </div>
    )
}
