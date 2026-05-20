'use client'

import { Dumbbell } from 'lucide-react'
import type { StrengthSession } from '@/types/database'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface StrengthIconStripProps {
  sessions: StrengthSession[]
  onOpen: (sessionId: number) => void
  onDragStart: (sessionId: number) => void
  onDragEnd: () => void
}

function statusClasses(status: StrengthSession['completion_status']): string {
  switch (status) {
    case 'completed':
      return 'text-emerald-600 dark:text-emerald-400'
    case 'partial':
      return 'text-amber-600 dark:text-amber-400'
    case 'skipped':
      return 'text-red-500 dark:text-red-400 opacity-60'
    case 'pending':
    default:
      return 'text-slate-600 dark:text-slate-300'
  }
}

const MAX_ICONS = 3

export function StrengthIconStrip({ sessions, onOpen, onDragStart, onDragEnd }: StrengthIconStripProps) {
  if (sessions.length === 0) return null

  const visible = sessions.slice(0, MAX_ICONS)
  const overflowCount = sessions.length - visible.length

  return (
    <div
      className="absolute bottom-0 left-0 right-0 z-10 flex items-center gap-0.5 px-1 pb-0.5 pointer-events-none"
      data-strength-icon-strip
    >
      {visible.map(session => (
        <Tooltip key={session.id}>
          <TooltipTrigger asChild>
            <button
              type="button"
              draggable
              onClick={(e) => {
                e.stopPropagation()
                onOpen(session.id)
              }}
              onDragStart={(e) => {
                e.stopPropagation()
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/x-strength-session', String(session.id))
                onDragStart(session.id)
              }}
              onDragEnd={(e) => {
                e.stopPropagation()
                onDragEnd()
              }}
              className={`pointer-events-auto rounded p-0.5 hover:bg-black/5 dark:hover:bg-white/10 cursor-grab active:cursor-grabbing ${statusClasses(session.completion_status)}`}
              aria-label={`Strength session: ${session.title}`}
            >
              <Dumbbell className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            <div className="font-medium">{session.title}</div>
            {session.estimated_duration_minutes && (
              <div className="text-muted-foreground">~{session.estimated_duration_minutes} min</div>
            )}
          </TooltipContent>
        </Tooltip>
      ))}
      {overflowCount > 0 && (
        <span className="pointer-events-auto ml-0.5 text-[10px] font-medium text-muted-foreground">
          +{overflowCount}
        </span>
      )}
    </div>
  )
}
