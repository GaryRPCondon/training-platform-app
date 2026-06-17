'use client'

import { useState } from 'react'
import { Dumbbell } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { StrengthSession } from '@/types/database'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const MAX_TOOLTIP_EXERCISES = 4

interface StrengthIconStripProps {
  sessions: StrengthSession[]
  onOpen: (sessionId: number) => void
  onDragStart: (sessionId: number) => void
  onDragEnd: () => void
  setSuppression: (autoClearMs?: number) => void
}

function statusClasses(status: StrengthSession['completion_status']): string {
  switch (status) {
    case 'completed':
      return 'bg-emerald-500/25 text-emerald-700 ring-1 ring-emerald-500/40 dark:bg-emerald-500/30 dark:text-emerald-200 dark:ring-emerald-400/40'
    case 'partial':
      return 'bg-amber-500/25 text-amber-700 ring-1 ring-amber-500/40 dark:bg-amber-500/30 dark:text-amber-200 dark:ring-amber-400/40'
    case 'skipped':
      return 'bg-red-500/25 text-red-700 ring-1 ring-red-500/40 dark:bg-red-500/30 dark:text-red-200 dark:ring-red-400/40'
    case 'pending':
    default:
      return 'bg-slate-500/20 text-slate-700 ring-1 ring-slate-500/30 dark:bg-slate-400/25 dark:text-slate-100 dark:ring-slate-300/30'
  }
}

const MAX_ICONS = 3

export function StrengthIconStrip({ sessions, onOpen, onDragStart, onDragEnd, setSuppression }: StrengthIconStripProps) {
  const t = useTranslations('strengthStrip')
  const [draggingId, setDraggingId] = useState<number | null>(null)

  if (sessions.length === 0) return null

  const visible = sessions.slice(0, MAX_ICONS)
  const overflow = sessions.slice(MAX_ICONS)
  const overflowCount = overflow.length

  return (
    <div
      className="absolute bottom-0 left-0 right-0 z-10 flex items-center gap-0.5 px-1 pb-1 pointer-events-none"
      data-strength-icon-strip
    >
      {visible.map(session => {
        const exerciseNames = session.exercises.slice(0, MAX_TOOLTIP_EXERCISES).map(e => e.display_name)
        const extraCount = session.exercises.length - exerciseNames.length
        const isDragging = draggingId === session.id
        return (
          <Tooltip key={session.id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                draggable
                onMouseDown={(e) => {
                  e.stopPropagation()
                  setSuppression(200)
                }}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  setSuppression(200)
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  onOpen(session.id)
                }}
                onDragStart={(e) => {
                  e.stopPropagation()
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/x-strength-session', String(session.id))
                  setDraggingId(session.id)
                  // Hold suppression for the entire drag (no auto-clear).
                  // Cleared with a grace window in onDragEnd.
                  setSuppression()
                  onDragStart(session.id)
                }}
                onDragEnd={(e) => {
                  e.stopPropagation()
                  setDraggingId(null)
                  // 300ms grace window covers drop → onSelectSlot timing.
                  setSuppression(300)
                  onDragEnd()
                }}
                className={`pointer-events-auto inline-flex h-6 w-6 items-center justify-center rounded-md shadow-sm transition-all hover:scale-110 cursor-grab active:cursor-grabbing ${isDragging ? 'opacity-40' : ''} ${statusClasses(session.completion_status)}`}
                aria-label={t('ariaSession', { title: session.title })}
              >
                <Dumbbell className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-xs">
              <div className="font-medium">{session.title}</div>
              {session.program_name && (
                <div className="text-muted-foreground">{t('fromProgram', { program: session.program_name })}</div>
              )}
              {session.estimated_duration_minutes && (
                <div className="text-muted-foreground">{t('durationMin', { min: session.estimated_duration_minutes })}</div>
              )}
              {exerciseNames.length > 0 && (
                <div className="mt-1 text-muted-foreground">
                  {exerciseNames.join(' · ')}{extraCount > 0 && ` ${t('plusMore', { count: extraCount })}`}
                </div>
              )}
            </TooltipContent>
          </Tooltip>
        )
      })}
      {overflowCount > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onMouseDown={(e) => {
                e.stopPropagation()
                setSuppression(200)
              }}
              onPointerDown={(e) => {
                e.stopPropagation()
                setSuppression(200)
              }}
              onClick={(e) => {
                e.stopPropagation()
                // Open the first overflow session; user can use the tooltip to
                // see which others are hidden.
                onOpen(overflow[0].id)
              }}
              className="pointer-events-auto ms-0.5 inline-flex h-6 items-center rounded-md bg-slate-500/15 px-1.5 text-[10px] font-medium text-slate-700 ring-1 ring-slate-500/30 hover:bg-slate-500/25 dark:bg-slate-400/20 dark:text-slate-100 dark:ring-slate-300/30"
              aria-label={t('ariaShowMore', { count: overflowCount })}
            >
              +{overflowCount}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-xs">
            <div className="font-medium">{t('moreSessions', { count: overflowCount })}</div>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {overflow.map(s => <li key={s.id}>{s.title}</li>)}
            </ul>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
