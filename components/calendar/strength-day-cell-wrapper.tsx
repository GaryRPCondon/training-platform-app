'use client'

import React, { createContext, useContext } from 'react'
import { format } from 'date-fns'
import type { StrengthSession } from '@/types/database'
import { StrengthIconStrip } from './strength-icon-strip'

interface StrengthCellContextValue {
  sessionsByDate: Map<string, StrengthSession[]>
  onOpen: (sessionId: number) => void
  onDragStart: (sessionId: number) => void
  onDragEnd: () => void
  onDrop: (sessionId: number, newDate: string) => void
}

export const StrengthCellContext = createContext<StrengthCellContextValue | null>(null)

const DRAG_MIME = 'text/x-strength-session'

// Matches react-big-calendar's DateCellWrapperProps shape so it can be passed
// directly via `components={{ dateCellWrapper }}` without casting.
interface DayCellWrapperProps {
  range?: Date[]
  value: Date
  children: React.JSX.Element
}

type DayCellElement = React.ReactElement<{
  children?: React.ReactNode
  onDragOver?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
}>

export function StrengthDayCellWrapper({ value, children }: DayCellWrapperProps) {
  const ctx = useContext(StrengthCellContext)
  const dateKey = format(value, 'yyyy-MM-dd')
  const sessions = ctx?.sessionsByDate.get(dateKey) ?? []

  const typedChild = children as DayCellElement
  const existingDragOver = typedChild.props.onDragOver
  const existingDrop = typedChild.props.onDrop

  const handleDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(DRAG_MIME)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      return
    }
    existingDragOver?.(e)
  }

  const handleDrop = (e: React.DragEvent) => {
    const sessionIdRaw = e.dataTransfer.getData(DRAG_MIME)
    if (sessionIdRaw) {
      e.preventDefault()
      e.stopPropagation()
      const sessionId = Number(sessionIdRaw)
      if (Number.isFinite(sessionId)) ctx?.onDrop(sessionId, dateKey)
      return
    }
    existingDrop?.(e)
  }

  return React.cloneElement(typedChild, {
    onDragOver: handleDragOver,
    onDrop: handleDrop,
    children: (
      <>
        {typedChild.props.children}
        {sessions.length > 0 && ctx && (
          <StrengthIconStrip
            sessions={sessions}
            onOpen={ctx.onOpen}
            onDragStart={ctx.onDragStart}
            onDragEnd={ctx.onDragEnd}
          />
        )}
      </>
    ),
  })
}
