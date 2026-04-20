'use client'

import { useState } from 'react'
import { Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'

interface PlanCompletionBannerProps {
    planId: number
    planName: string
}

export function PlanCompletionBanner({ planId, planName }: PlanCompletionBannerProps) {
    const [loading, setLoading] = useState(false)
    const [dismissed, setDismissed] = useState(false)
    const router = useRouter()

    if (dismissed) return null

    async function handleComplete() {
        setLoading(true)
        try {
            const res = await fetch(`/api/plans/${planId}/complete`, { method: 'POST' })
            if (!res.ok) {
                const data = await res.json()
                throw new Error(data.error || 'Failed to complete plan')
            }
            toast.success(`${planName} marked as complete — well done!`)
            router.refresh()
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to complete plan')
            setLoading(false)
        }
    }

    return (
        <div className="flex items-center gap-4 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 px-4 py-3">
            <Trophy className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
                    You&apos;ve completed <span className="font-semibold">{planName}</span> — great work!
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                    Mark it as complete to preserve it as a historical record.
                </p>
            </div>
            <div className="flex gap-2 shrink-0">
                <Button
                    size="sm"
                    variant="outline"
                    className="border-amber-300 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-200 dark:hover:bg-amber-900"
                    onClick={() => setDismissed(true)}
                >
                    Later
                </Button>
                <Button
                    size="sm"
                    className="bg-amber-600 hover:bg-amber-700 text-white"
                    onClick={handleComplete}
                    disabled={loading}
                >
                    {loading ? 'Saving…' : 'Mark Complete'}
                </Button>
            </div>
        </div>
    )
}
