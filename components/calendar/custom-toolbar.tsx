'use client'

import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight, Link2 } from 'lucide-react'
import { format } from 'date-fns'

interface CustomToolbarProps {
    date: Date
    view: 'month' | 'week' | 'day'
    onNavigate: (action: 'PREV' | 'NEXT' | 'TODAY') => void
    onViewChange: (view: 'month' | 'week' | 'day') => void
    onAutoMatch?: () => void
    isAutoMatching?: boolean
}

export function CustomToolbar({ date, view, onNavigate, onViewChange, onAutoMatch, isAutoMatching }: CustomToolbarProps) {
    return (
        <div className="flex items-center justify-between mb-4 px-2">
            <div className="flex items-center gap-2">
                <div className="flex items-center rounded-md border bg-background p-1">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onNavigate('TODAY')}
                        className="h-7 px-3 text-xs"
                    >
                        Today
                    </Button>
                    <div className="h-4 w-[1px] bg-border mx-1" />
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onNavigate('PREV')}
                        className="h-7 w-7"
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onNavigate('NEXT')}
                        className="h-7 w-7"
                    >
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>
                <h2 className="text-xl font-semibold ml-2">
                    {format(date, 'MMMM yyyy')}
                </h2>
                {onAutoMatch && (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={onAutoMatch}
                        disabled={isAutoMatching}
                        className="h-7 px-3 text-xs ml-4"
                    >
                        <Link2 className="h-3 w-3 mr-1.5" />
                        {isAutoMatching ? 'Matching...' : 'Auto-Match Activities'}
                    </Button>
                )}
            </div>

            <div className="flex items-center rounded-md border bg-background p-1">
                {(['month', 'week', 'day'] as const).map((v) => (
                    <Button
                        key={v}
                        variant={view === v ? 'secondary' : 'ghost'}
                        size="sm"
                        onClick={() => onViewChange(v)}
                        className="h-7 px-3 text-xs capitalize"
                    >
                        {v}
                    </Button>
                ))}
            </div>
        </div>
    )
}
