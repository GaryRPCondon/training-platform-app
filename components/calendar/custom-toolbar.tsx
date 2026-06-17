'use client'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { ChevronLeft, ChevronRight, Link2 } from 'lucide-react'
import { format } from 'date-fns'
import { useTranslations } from 'next-intl'

interface CustomToolbarProps {
    date: Date
    onNavigate: (action: 'PREV' | 'NEXT' | 'TODAY') => void
    onAutoMatch?: () => void
    isAutoMatching?: boolean
    runningOnly?: boolean
    onRunningOnlyChange?: (value: boolean) => void
}

export function CustomToolbar({ date, onNavigate, onAutoMatch, isAutoMatching, runningOnly, onRunningOnlyChange }: CustomToolbarProps) {
    const t = useTranslations('calendar')
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
                        {t('today')}
                    </Button>
                    <div className="h-4 w-[1px] bg-border mx-1" />
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => onNavigate('PREV')}
                                className="h-7 w-7"
                                aria-label={t('previousMonth')}
                            >
                                <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t('previousMonth')}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => onNavigate('NEXT')}
                                className="h-7 w-7"
                                aria-label={t('nextMonth')}
                            >
                                <ChevronRight className="h-4 w-4 rtl:rotate-180" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t('nextMonth')}</TooltipContent>
                    </Tooltip>
                </div>
                <h2 className="text-xl font-semibold ms-2">
                    {format(date, 'MMMM yyyy')}
                </h2>
                {onAutoMatch && (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={onAutoMatch}
                        disabled={isAutoMatching}
                        className="h-7 px-3 text-xs ms-4"
                    >
                        <Link2 className="h-3 w-3 me-1.5" />
                        {isAutoMatching ? t('matching') : t('autoMatch')}
                    </Button>
                )}
                <div aria-live="polite" role="status" className="sr-only">
                    {isAutoMatching ? t('matchingStatus') : ''}
                </div>
            </div>
            {onRunningOnlyChange && (
                <div className="flex items-center gap-2">
                    <Label
                        htmlFor="running-only"
                        className="text-xs text-muted-foreground cursor-pointer select-none"
                    >
                        {t('runningOnly')}
                    </Label>
                    <Switch
                        id="running-only"
                        checked={runningOnly}
                        onCheckedChange={onRunningOnlyChange}
                    />
                </div>
            )}
        </div>
    )
}
