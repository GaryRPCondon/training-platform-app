'use client'

import { useState, useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { WorkoutWithDetails } from '@/types/review'
import type { TrainingPaces } from '@/types/database'
import {
  Calendar, Clock, TrendingUp, Target, Gauge, Flag, RotateCcw,
  CheckCircle, AlertCircle, XCircle, Pencil, Plus,
  ChevronUp, Repeat2, Trash2, Sparkles, Loader2,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { Calendar as CalendarPicker } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Checkbox } from '@/components/ui/checkbox'
import { estimateDuration, getWorkoutPaceType, calculateTotalWorkoutDistance } from '@/lib/training/vdot'
import { useUnits } from '@/lib/hooks/use-units'
import { formatDistance as fmtDist, type UnitSystem } from '@/lib/utils/units'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'

const INTENSITY_OPTIONS = ['easy', 'moderate', 'marathon', 'hard', 'tempo', 'threshold', 'interval', 'recovery', 'custom']

const WORKOUT_TYPES = ['easy_run', 'long_run', 'intervals', 'tempo', 'rest', 'cross_training', 'recovery', 'race'] as const

const KM_TO_MILES = 0.621371

function formatWorkoutType(type: string): string {
  return type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

interface WorkoutCardProps {
  workout: WorkoutWithDetails
  trainingPaces?: TrainingPaces | null
  vdot?: number | null
  onClose?: () => void
  onDiscuss?: (workout: WorkoutWithDetails) => void
  editable?: boolean
  onSaved?: (updated: WorkoutWithDetails) => void
  garminConnected?: boolean
  onSendToGarmin?: (workoutId: number) => Promise<void>
  onRemoveFromGarmin?: (workoutId: number) => Promise<void>
  onDeleted?: () => void
  /** When true: starts directly in edit mode, calls POST /api/workouts on save */
  isNew?: boolean
  /** Called after a new workout is successfully created */
  onCreated?: () => void
}

// ============================================================================
// Edit state types
// ============================================================================

interface EditableWarmupCooldown {
  duration_minutes?: number
  distance_meters?: number
  intensity?: string
  target_pace?: string
}

interface EditableInterval {
  distance_meters?: number
  duration_seconds?: number
  target_pace?: string
  intensity?: string
}

interface EditableSet {
  repeat: number
  intervals: EditableInterval[]
  skip_last_recovery?: boolean
}

interface EditableStructured {
  warmup?: EditableWarmupCooldown
  main_set: EditableSet[]
  cooldown?: EditableWarmupCooldown
}

// ============================================================================
// Distance estimation for live total
// ============================================================================

function estimatePartDistance(
  part: EditableWarmupCooldown,
  trainingPaces: TrainingPaces | null | undefined
): number {
  if (part.distance_meters) return part.distance_meters
  if (part.duration_minutes && trainingPaces) {
    const easyPace = trainingPaces.easy
    const km = (part.duration_minutes * 60) / easyPace
    return km * 1000
  }
  return 0
}

function estimateIntervalDistance(
  interval: EditableInterval,
  trainingPaces: TrainingPaces | null | undefined
): number {
  if (interval.distance_meters) return interval.distance_meters
  if (interval.duration_seconds && trainingPaces) {
    const isRecovery = interval.intensity?.toLowerCase().includes('recovery')
    const paceSecPerKm = isRecovery ? trainingPaces.easy : trainingPaces.interval
    const km = interval.duration_seconds / paceSecPerKm
    return km * 1000
  }
  return 0
}

function calcTotalDistance(
  structured: EditableStructured,
  trainingPaces: TrainingPaces | null | undefined
): number {
  let total = 0
  if (structured.warmup) {
    total += estimatePartDistance(structured.warmup, trainingPaces)
  }
  for (const set of structured.main_set) {
    const intervalTotal = set.intervals.reduce(
      (sum, int) => sum + estimateIntervalDistance(int, trainingPaces),
      0
    )
    total += set.repeat * intervalTotal
  }
  if (structured.cooldown) {
    total += estimatePartDistance(structured.cooldown, trainingPaces)
  }
  return total
}

// ============================================================================
// Pace range utilities
// ============================================================================

const PACE_SCALE_KM_TO_MI = 1.60934

function parseSinglePaceSec(s: string): number | null {
  const match = s.trim().replace(/\/.*$/, '').match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10)
}

/** Parse stored "M:SS" or "M:SS-M:SS" (sec/km) into display inputs (user's units) */
function parsePaceToDisplayInputs(
  targetPace: string | undefined,
  units: UnitSystem
): { fasterM: string; fasterS: string; slowerM: string; slowerS: string } {
  const toDisplay = (secKm: number) => {
    const sec = units === 'imperial' ? secKm * PACE_SCALE_KM_TO_MI : secKm
    return { m: Math.floor(sec / 60), s: Math.round(sec % 60) }
  }
  const fmt = (n: { m: number; s: number }) => ({ m: String(n.m), s: String(n.s).padStart(2, '0') })

  if (targetPace) {
    const dash = targetPace.indexOf('-', 1)
    if (dash > 0) {
      const fSec = parseSinglePaceSec(targetPace.slice(0, dash))
      const sSec = parseSinglePaceSec(targetPace.slice(dash + 1))
      if (fSec !== null && sSec !== null) {
        const f = fmt(toDisplay(fSec)); const sl = fmt(toDisplay(sSec))
        return { fasterM: f.m, fasterS: f.s, slowerM: sl.m, slowerS: sl.s }
      }
    }
    const single = parseSinglePaceSec(targetPace)
    if (single !== null) {
      const f = fmt(toDisplay(single - 15)); const sl = fmt(toDisplay(single + 15))
      return { fasterM: f.m, fasterS: f.s, slowerM: sl.m, slowerS: sl.s }
    }
  }
  return { fasterM: '', fasterS: '', slowerM: '', slowerS: '' }
}

/** Serialize 4 display inputs → "M:SS-M:SS" stored as sec/km */
function serializePaceInputs(
  fasterM: string, fasterS: string, slowerM: string, slowerS: string,
  units: UnitSystem
): string | undefined {
  const toSecKm = (m: string, s: string) => {
    const sec = (parseInt(m, 10) || 0) * 60 + (parseInt(s, 10) || 0)
    return units === 'imperial' ? sec / PACE_SCALE_KM_TO_MI : sec
  }
  const fOk = fasterM !== '' && fasterS !== ''
  const sOk = slowerM !== '' && slowerS !== ''
  if (!fOk && !sOk) return undefined
  const fmtKm = (sec: number) =>
    `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`
  if (fOk && sOk) {
    return `${fmtKm(toSecKm(fasterM, fasterS))}-${fmtKm(toSecKm(slowerM, slowerS))}`
  }
  const m = fOk ? fasterM : slowerM; const s = fOk ? fasterS : slowerS
  return fmtKm(toSecKm(m, s))
}

/** Format stored target_pace (or VDOT fallback) for the collapsed row */
function fmtPaceRangeDisplay(
  targetPace: string | undefined,
  trainingPaces: TrainingPaces | null | undefined,
  intensity: string | undefined,
  units: UnitSystem
): string {
  let fKm: number | null = null; let sKm: number | null = null
  if (targetPace) {
    const dash = targetPace.indexOf('-', 1)
    if (dash > 0) {
      fKm = parseSinglePaceSec(targetPace.slice(0, dash))
      sKm = parseSinglePaceSec(targetPace.slice(dash + 1))
    } else {
      const c = parseSinglePaceSec(targetPace)
      if (c !== null) { fKm = c - 15; sKm = c + 15 }
    }
  } else if (trainingPaces && intensity) {
    const c = trainingPaces[intensityToPaceKey(intensity)]
    if (c) { fKm = c - 15; sKm = c + 15 }
  }
  if (fKm === null || sKm === null) return ''
  const unit = units === 'imperial' ? '/mi' : '/km'
  const scale = units === 'imperial' ? PACE_SCALE_KM_TO_MI : 1
  const fmt = (sec: number) => {
    const s = sec * scale
    return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
  }
  return `${fmt(fKm)}–${fmt(sKm)}${unit}`
}

function intensityToPaceKey(intensity: string): keyof TrainingPaces {
  const l = intensity.toLowerCase()
  if (l.includes('recovery') || l.includes('easy')) return 'easy'
  if (l.includes('moderate')) return 'marathon'
  if (l.includes('marathon')) return 'marathon'
  if (l.includes('tempo') || l.includes('threshold')) return 'tempo'
  if (l.includes('interval') || l.includes('hard') || l.includes('repetition')) return 'interval'
  return 'easy'
}

function fmtCenterPace(secKm: number, units: UnitSystem): string {
  const sec = units === 'imperial' ? secKm * PACE_SCALE_KM_TO_MI : secKm
  const unit = units === 'imperial' ? '/mi' : '/km'
  return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}${unit}`
}

// ============================================================================
// Shared sub-components
// ============================================================================

function IntensityDot({ intensity }: { intensity?: string }) {
  const l = intensity?.toLowerCase() ?? ''
  const color = l.includes('recovery') || l.includes('moderate')
    ? 'bg-yellow-400'
    : l.includes('hard') || l.includes('tempo') || l.includes('interval') || l.includes('threshold')
    ? 'bg-red-500'
    : 'bg-green-500'
  return <span className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${color}`} />
}

function IntensitySelect({
  value,
  onChange,
}: {
  value: string | undefined
  onChange: (v: string) => void
}) {
  return (
    <Select value={value ?? ''} onValueChange={onChange}>
      <SelectTrigger className="h-8 text-xs">
        <SelectValue placeholder="Intensity" />
      </SelectTrigger>
      <SelectContent>
        {INTENSITY_OPTIONS.map(opt => (
          <SelectItem key={opt} value={opt} className="text-xs">{opt}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// ============================================================================
// Warmup / Cooldown step row + inline form
// ============================================================================

function WarmupCooldownStep({
  label, data, rowKey, expandedKey, onToggle, onChange, onRemove, units, trainingPaces,
}: {
  label: string
  data: EditableWarmupCooldown
  rowKey: string
  expandedKey: string | null
  onToggle: () => void
  onChange: (v: EditableWarmupCooldown) => void
  onRemove: () => void
  units: UnitSystem
  trainingPaces?: TrainingPaces | null
}) {
  const isExpanded = expandedKey === rowKey
  const isCustom = data.intensity === 'custom'
  const metric = data.duration_minutes
    ? `${data.duration_minutes} min`
    : data.distance_meters
    ? `${data.distance_meters} m`
    : ''

  // Local pace state for custom intensity (M and SS inputs)
  const [paceInputs, setPaceInputs] = useState(() => {
    if (!data.target_pace) return { m: '', s: '' }
    const sec = parseSinglePaceSec(data.target_pace)
    if (sec === null) return { m: '', s: '' }
    const display = units === 'imperial' ? sec * PACE_SCALE_KM_TO_MI : sec
    return { m: String(Math.floor(display / 60)), s: String(Math.round(display % 60)).padStart(2, '0') }
  })

  const handlePaceInput = (field: 'm' | 's', val: string) => {
    const next = { ...paceInputs, [field]: val }
    setPaceInputs(next)
    if (next.m !== '' && next.s !== '') {
      const secDisplay = (parseInt(next.m, 10) || 0) * 60 + (parseInt(next.s, 10) || 0)
      const secKm = units === 'imperial' ? secDisplay / PACE_SCALE_KM_TO_MI : secDisplay
      const stored = `${Math.floor(secKm / 60)}:${String(Math.round(secKm % 60)).padStart(2, '0')}`
      onChange({ ...data, target_pace: stored })
    }
  }

  const paceUnit = units === 'imperial' ? '/mi' : '/km'
  const paceDisplay = isCustom && data.target_pace ? fmtCenterPace(
    parseSinglePaceSec(data.target_pace) ?? 0, units
  ) : null

  return (
    <div>
      {/* Collapsed row */}
      <div className="flex items-center gap-2 h-9 px-1 text-sm">
        <IntensityDot intensity={data.intensity ?? 'easy'} />
        <span className="flex-1 font-medium">{label}</span>
        <span className="text-xs text-muted-foreground w-14 text-right shrink-0">{metric}</span>
        {paceDisplay
          ? <span className="text-xs text-muted-foreground shrink-0">{paceDisplay}</span>
          : <span className="w-28 shrink-0" />
        }
        {data.intensity && (
          <Badge variant="outline" className="text-xs h-5 px-1.5 shrink-0">{data.intensity}</Badge>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={onToggle}
          aria-label={isExpanded ? `Collapse ${label}` : `Edit ${label}`}
        >
          {isExpanded ? <ChevronUp className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
        </Button>
      </div>

      {/* Expanded form */}
      {isExpanded && (
        <div className="mx-1 mb-1 border rounded-md p-3 bg-muted/20 space-y-3">
          <div className="flex items-end gap-2 flex-wrap">
            <div className="space-y-1">
              <Label className="text-xs">Duration</Label>
              <div className="flex items-center gap-1">
                <Input
                  type="number" min={0} placeholder="—"
                  className="h-8 w-16 text-sm"
                  value={data.duration_minutes ?? ''}
                  onChange={e => onChange({ ...data, duration_minutes: e.target.value ? Number(e.target.value) : undefined })}
                />
                <span className="text-xs text-muted-foreground">min</span>
              </div>
            </div>
            <span className="text-xs text-muted-foreground mb-2">or</span>
            <div className="space-y-1">
              <Label className="text-xs">Distance</Label>
              <div className="flex items-center gap-1">
                <Input
                  type="number" min={0} placeholder="—"
                  className="h-8 w-20 text-sm"
                  value={data.distance_meters ?? ''}
                  onChange={e => onChange({ ...data, distance_meters: e.target.value ? Number(e.target.value) : undefined })}
                />
                <span className="text-xs text-muted-foreground">m</span>
              </div>
            </div>
            <div className="space-y-1 flex-1 min-w-[110px]">
              <Label className="text-xs">Intensity</Label>
              <IntensitySelect
                value={data.intensity}
                onChange={intensity => onChange({ ...data, intensity, target_pace: intensity !== 'custom' ? undefined : data.target_pace })}
              />
            </div>
            {(() => {
              const rangeStr = isCustom
                ? fmtPaceRangeDisplay(data.target_pace, undefined, undefined, units)
                : fmtPaceRangeDisplay(undefined, trainingPaces, data.intensity, units)
              if (!rangeStr) return null
              return (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Pace range</Label>
                  <div className="h-8 flex items-center">
                    <span className="text-xs font-mono">{rangeStr}</span>
                  </div>
                </div>
              )
            })()}
          </div>

          {/* Custom pace — only when intensity is 'custom' */}
          {isCustom && (
            <div className="space-y-1">
              <Label className="text-xs">Pace</Label>
              <div className="flex items-center gap-1">
                <Input
                  type="number" min={0} max={99} placeholder="M"
                  className="h-8 w-10 text-sm text-center px-1"
                  value={paceInputs.m}
                  onChange={e => handlePaceInput('m', e.target.value)}
                />
                <span className="text-sm font-mono text-muted-foreground">:</span>
                <Input
                  type="number" min={0} max={59} placeholder="SS"
                  className="h-8 w-12 text-sm text-center px-1"
                  value={paceInputs.s}
                  onChange={e => handlePaceInput('s', e.target.value)}
                />
                <span className="text-xs text-muted-foreground">{paceUnit}</span>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              size="sm" variant="ghost"
              className="h-7 text-xs text-destructive hover:text-destructive"
              onClick={onRemove}
            >
              <Trash2 className="h-3 w-3 mr-1" />Remove
            </Button>
            <Button size="sm" className="h-7 text-xs" onClick={onToggle}>Done</Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Interval step row + inline form
// ============================================================================

function IntervalStep({
  set, interval, isFirstInSet,
  rowKey, expandedKey, onToggle,
  onChange, onChangeSet, onRemove,
  trainingPaces, units,
}: {
  set: EditableSet
  interval: EditableInterval
  isFirstInSet: boolean
  rowKey: string
  expandedKey: string | null
  onToggle: () => void
  onChange: (v: EditableInterval) => void
  onChangeSet: (v: EditableSet) => void
  onRemove: () => void
  trainingPaces: TrainingPaces | null | undefined
  units: UnitSystem
}) {
  const isExpanded = expandedKey === rowKey
  const isIndented = !isFirstInSet
  const hasMultiple = set.intervals.length > 1 || set.repeat > 1
  const showRepeat = isFirstInSet && hasMultiple
  const hasRecovery = isFirstInSet && set.intervals.some(
    i => i.intensity?.toLowerCase().includes('recovery') || i.intensity?.toLowerCase().includes('rest')
  )

  const distLabel = interval.distance_meters
    ? `${interval.distance_meters} m`
    : interval.duration_seconds
    ? `${interval.duration_seconds} s`
    : 'Step'
  const label = showRepeat ? `${set.repeat} × ${distLabel}` : distLabel

  const paceDisplay = isFirstInSet
    ? fmtPaceRangeDisplay(interval.target_pace, trainingPaces, interval.intensity, units)
    : ''

  const vdotLabel = (() => {
    if (!trainingPaces || !interval.intensity) return null
    const sec = trainingPaces[intensityToPaceKey(interval.intensity)]
    return sec ? fmtCenterPace(sec, units) : null
  })()

  // Pace inputs — local state, initialized from target_pace on mount
  const [paceInputs, setPaceInputs] = useState(() =>
    parsePaceToDisplayInputs(interval.target_pace, units)
  )

  const handlePaceInput = (field: keyof typeof paceInputs, val: string) => {
    const next = { ...paceInputs, [field]: val }
    setPaceInputs(next)
    const serialized = serializePaceInputs(next.fasterM, next.fasterS, next.slowerM, next.slowerS, units)
    onChange({ ...interval, target_pace: serialized })
  }

  const paceUnit = units === 'imperial' ? '/mi' : '/km'

  return (
    <div>
      {/* Collapsed row */}
      <div className={`flex items-center gap-2 h-9 px-1 text-sm ${isIndented ? 'pl-6' : ''}`}>
        <IntensityDot intensity={interval.intensity} />
        <span className="flex-1 font-medium truncate min-w-0">{label}</span>
        {paceDisplay && (
          <span className="text-xs text-muted-foreground shrink-0">{paceDisplay}</span>
        )}
        {interval.intensity && (
          <Badge variant="outline" className="text-xs h-5 px-1.5 shrink-0">{interval.intensity}</Badge>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={onToggle}
          aria-label={isExpanded ? 'Collapse step' : 'Edit step'}
        >
          {isExpanded ? <ChevronUp className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
        </Button>
      </div>

      {/* Expanded form */}
      {isExpanded && (
        <div className="mx-1 mb-1 border rounded-md p-3 bg-muted/20 space-y-3">
          {/* Repeat — only for first interval in a multi-repeat or multi-interval set */}
          {showRepeat && (
            <div className="flex items-center gap-2">
              <Label className="text-xs w-14 shrink-0">Repeat</Label>
              <Input
                type="number" min={1}
                className="h-8 w-16 text-sm"
                value={set.repeat}
                onChange={e => onChangeSet({ ...set, repeat: Math.max(1, Number(e.target.value) || 1) })}
              />
              <span className="text-xs text-muted-foreground">times</span>
            </div>
          )}

          {/* Distance / Duration */}
          <div className="flex items-end gap-2 flex-wrap">
            <div className="space-y-1">
              <Label className="text-xs">Distance</Label>
              <div className="flex items-center gap-1">
                <Input
                  type="number" min={0} placeholder="—"
                  className="h-8 w-20 text-sm"
                  value={interval.distance_meters ?? ''}
                  onChange={e => onChange({ ...interval, distance_meters: e.target.value ? Number(e.target.value) : undefined })}
                />
                <span className="text-xs text-muted-foreground">m</span>
              </div>
            </div>
            <span className="text-xs text-muted-foreground mb-2">or</span>
            <div className="space-y-1">
              <Label className="text-xs">Duration</Label>
              <div className="flex items-center gap-1">
                <Input
                  type="number" min={0} placeholder="—"
                  className="h-8 w-16 text-sm"
                  value={interval.duration_seconds ?? ''}
                  onChange={e => onChange({ ...interval, duration_seconds: e.target.value ? Number(e.target.value) : undefined })}
                />
                <span className="text-xs text-muted-foreground">s</span>
              </div>
            </div>
          </div>

          {/* Pace range */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <Label className="text-xs">Pace range</Label>
              {vdotLabel && (
                <span className="text-xs text-muted-foreground">VDOT target: {vdotLabel}</span>
              )}
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              <Input
                type="number" min={0} max={99} placeholder="M"
                className="h-8 w-10 text-sm text-center px-1"
                value={paceInputs.fasterM}
                onChange={e => handlePaceInput('fasterM', e.target.value)}
              />
              <span className="text-sm font-mono text-muted-foreground">:</span>
              <Input
                type="number" min={0} max={59} placeholder="SS"
                className="h-8 w-12 text-sm text-center px-1"
                value={paceInputs.fasterS}
                onChange={e => handlePaceInput('fasterS', e.target.value)}
              />
              <span className="text-xs text-muted-foreground mx-1">to</span>
              <Input
                type="number" min={0} max={99} placeholder="M"
                className="h-8 w-10 text-sm text-center px-1"
                value={paceInputs.slowerM}
                onChange={e => handlePaceInput('slowerM', e.target.value)}
              />
              <span className="text-sm font-mono text-muted-foreground">:</span>
              <Input
                type="number" min={0} max={59} placeholder="SS"
                className="h-8 w-12 text-sm text-center px-1"
                value={paceInputs.slowerS}
                onChange={e => handlePaceInput('slowerS', e.target.value)}
              />
              <span className="text-xs text-muted-foreground ml-1">{paceUnit}</span>
            </div>
          </div>

          {/* Intensity */}
          <div className="space-y-1">
            <Label className="text-xs">Intensity</Label>
            <IntensitySelect
              value={interval.intensity}
              onChange={intensity => {
                // When switching to a non-custom intensity, auto-populate the pace
                // range inputs from VDOT and clear any explicit target_pace override
                if (intensity !== 'custom' && trainingPaces) {
                  const centerSecKm = trainingPaces[intensityToPaceKey(intensity)]
                  if (centerSecKm) {
                    const toDisplay = (secKm: number) => {
                      const sec = units === 'imperial' ? secKm * PACE_SCALE_KM_TO_MI : secKm
                      return { m: String(Math.floor(sec / 60)), s: String(Math.round(sec % 60)).padStart(2, '0') }
                    }
                    const f = toDisplay(centerSecKm - 15)
                    const sl = toDisplay(centerSecKm + 15)
                    setPaceInputs({ fasterM: f.m, fasterS: f.s, slowerM: sl.m, slowerS: sl.s })
                  } else {
                    setPaceInputs({ fasterM: '', fasterS: '', slowerM: '', slowerS: '' })
                  }
                }
                onChange({ ...interval, intensity, target_pace: intensity !== 'custom' ? undefined : interval.target_pace })
              }}
            />
          </div>

          {/* Skip last recovery */}
          {hasRecovery && (
            <div className="flex items-center gap-2">
              <Checkbox
                id={`skip-recovery-${rowKey}`}
                checked={!!set.skip_last_recovery}
                onCheckedChange={checked => onChangeSet({ ...set, skip_last_recovery: !!checked })}
              />
              <Label htmlFor={`skip-recovery-${rowKey}`} className="text-xs cursor-pointer">
                Skip recovery after last rep
              </Label>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Button
              size="sm" variant="ghost"
              className="h-7 text-xs text-destructive hover:text-destructive"
              onClick={onRemove}
            >
              <Trash2 className="h-3 w-3 mr-1" />Remove
            </Button>
            <Button size="sm" className="h-7 text-xs" onClick={onToggle}>Done</Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Structured workout editor — compact step list
// ============================================================================

function StructuredWorkoutEditor({
  structured,
  onChange,
  trainingPaces,
  units,
}: {
  structured: EditableStructured
  onChange: (v: EditableStructured) => void
  trainingPaces: TrainingPaces | null | undefined
  units: UnitSystem
}) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const totalMeters = useMemo(
    () => calcTotalDistance(structured, trainingPaces),
    [structured, trainingPaces]
  )

  const toggle = (key: string) =>
    setExpandedKey(prev => (prev === key ? null : key))

  const updateSet = (setIdx: number, v: EditableSet) => {
    const updated = [...structured.main_set]
    updated[setIdx] = v
    onChange({ ...structured, main_set: updated })
  }

  const removeSet = (setIdx: number) =>
    onChange({ ...structured, main_set: structured.main_set.filter((_, i) => i !== setIdx) })

  const updateInterval = (setIdx: number, intIdx: number, v: EditableInterval) => {
    const set = structured.main_set[setIdx]
    const intervals = [...set.intervals]
    intervals[intIdx] = v
    updateSet(setIdx, { ...set, intervals })
  }

  const removeInterval = (setIdx: number, intIdx: number) => {
    const set = structured.main_set[setIdx]
    if (set.intervals.length <= 1) {
      removeSet(setIdx)
    } else {
      updateSet(setIdx, { ...set, intervals: set.intervals.filter((_, i) => i !== intIdx) })
    }
  }

  const addStep = () => {
    const newIdx = structured.main_set.length
    onChange({ ...structured, main_set: [...structured.main_set, { repeat: 1, intervals: [{ intensity: 'easy' }] }] })
    setExpandedKey(`s${newIdx}i0`)
  }

  const addRepeat = () => {
    const newIdx = structured.main_set.length
    onChange({
      ...structured,
      main_set: [
        ...structured.main_set,
        { repeat: 3, intervals: [{ intensity: 'hard' }, { intensity: 'recovery' }] },
      ],
    })
    setExpandedKey(`s${newIdx}i0`)
  }

  return (
    <div className="space-y-0.5">
      {structured.warmup !== undefined && (
        <WarmupCooldownStep
          label="Warmup"
          data={structured.warmup}
          rowKey="warmup"
          expandedKey={expandedKey}
          onToggle={() => toggle('warmup')}
          onChange={v => onChange({ ...structured, warmup: v })}
          onRemove={() => onChange({ ...structured, warmup: undefined })}
          units={units}
          trainingPaces={trainingPaces}
        />
      )}

      {structured.main_set.map((set, setIdx) =>
        set.intervals.map((interval, intIdx) => {
          const rowKey = `s${setIdx}i${intIdx}`
          return (
            <IntervalStep
              key={rowKey}
              set={set}
              interval={interval}
              isFirstInSet={intIdx === 0}
              rowKey={rowKey}
              expandedKey={expandedKey}
              onToggle={() => toggle(rowKey)}
              onChange={v => updateInterval(setIdx, intIdx, v)}
              onChangeSet={v => updateSet(setIdx, v)}
              onRemove={() => removeInterval(setIdx, intIdx)}
              trainingPaces={trainingPaces}
              units={units}
            />
          )
        })
      )}

      {structured.cooldown !== undefined && (
        <WarmupCooldownStep
          label="Cooldown"
          data={structured.cooldown}
          rowKey="cooldown"
          expandedKey={expandedKey}
          onToggle={() => toggle('cooldown')}
          onChange={v => onChange({ ...structured, cooldown: v })}
          onRemove={() => onChange({ ...structured, cooldown: undefined })}
          units={units}
          trainingPaces={trainingPaces}
        />
      )}

      <div className="flex items-center gap-1 pt-2">
        <Button
          variant="ghost" size="sm"
          className="h-7 text-xs gap-1 text-muted-foreground"
          onClick={addStep}
        >
          <Plus className="h-3 w-3" />Add step
        </Button>
        <Button
          variant="ghost" size="sm"
          className="h-7 text-xs gap-1 text-muted-foreground"
          onClick={addRepeat}
        >
          <Repeat2 className="h-3 w-3" />Add repeat
        </Button>
      </div>

      {totalMeters > 0 && (
        <div className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1 mt-1">
          Approx. distance: {fmtDist(totalMeters, units, 1)}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Main WorkoutCard component
// ============================================================================

export function WorkoutCard({
  workout,
  trainingPaces,
  vdot,
  onClose,
  onDiscuss,
  editable = false,
  onSaved,
  garminConnected,
  onSendToGarmin,
  onRemoveFromGarmin,
  onDeleted,
  isNew = false,
  onCreated,
}: WorkoutCardProps) {
  const { units, formatDistance, formatPace, toDisplayDistance, distanceLabel } = useUnits()
  const queryClient = useQueryClient()

  const [isEditing, setIsEditing] = useState(isNew)
  const [isSaving, setIsSaving] = useState(false)
  const [editWorkoutType, setEditWorkoutType] = useState<typeof WORKOUT_TYPES[number]>(workout.workout_type)
  const [isSendingToGarmin, setIsSendingToGarmin] = useState(false)
  const [isRemovingFromGarmin, setIsRemovingFromGarmin] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const [isRescheduling, setIsRescheduling] = useState(false)

  // Edit state — initialized from workout when edit mode is toggled on
  const [editDescription, setEditDescription] = useState(workout.description ?? '')
  const [editDistanceDisplay, setEditDistanceDisplay] = useState(
    workout.distance_target_meters
      ? toDisplayDistance(workout.distance_target_meters).toFixed(2)
      : ''
  )
  const [editIntensity, setEditIntensity] = useState(workout.intensity_target ?? '')
  const [editDurationMinutes, setEditDurationMinutes] = useState(
    workout.duration_target_seconds ? String(Math.round(workout.duration_target_seconds / 60)) : ''
  )
  const [editStructured, setEditStructured] = useState<EditableStructured | null>(() => {
    // Initialise from workout.structured_workout so that isNew mode (which never
    // calls enterEditMode) still gets the structured breakdown prepopulated.
    if (!workout.structured_workout) return null
    const raw = workout.structured_workout as Record<string, unknown>
    const rawMainSet = raw.main_set
    if (!rawMainSet || !Array.isArray(rawMainSet)) return null
    return {
      warmup: raw.warmup as EditableWarmupCooldown | undefined,
      main_set: rawMainSet.map((s: unknown) => {
        const set = s as Record<string, unknown>
        return {
          repeat: (set.repeat as number) ?? 1,
          intervals: Array.isArray(set.intervals) ? (set.intervals as EditableInterval[]) : [],
          skip_last_recovery: (set.skip_last_recovery as boolean) ?? false,
        }
      }),
      cooldown: raw.cooldown as EditableWarmupCooldown | undefined,
    }
  })
  const [editCustomPaceM, setEditCustomPaceM] = useState('')
  const [editCustomPaceS, setEditCustomPaceS] = useState('')

  // Live pace range preview for the edit form (col 2, row 2 in the grid)
  const editPaceRangeStr = useMemo(() => {
    if (!isEditing) return ''
    if (editIntensity === 'custom') {
      const m = parseInt(editCustomPaceM, 10)
      const s = parseInt(editCustomPaceS, 10)
      if (isNaN(m) || isNaN(s) || (m === 0 && s === 0)) return ''
      const secDisplay = m * 60 + s
      const secKm = units === 'imperial' ? secDisplay / PACE_SCALE_KM_TO_MI : secDisplay
      const stored = `${Math.floor(secKm / 60)}:${String(Math.round(secKm % 60)).padStart(2, '0')}`
      return fmtPaceRangeDisplay(stored, undefined, undefined, units)
    }
    return editIntensity
      ? fmtPaceRangeDisplay(undefined, trainingPaces, editIntensity, units)
      : ''
  }, [isEditing, editIntensity, editCustomPaceM, editCustomPaceS, trainingPaces, units])

  const hasStructuredWorkout = !!(
    workout.structured_workout?.main_set &&
    Array.isArray((workout.structured_workout as Record<string, unknown>).main_set)
  )

  // Calculate total workout distance (includes warmup/cooldown/recovery for intervals and tempo)
  const totalWorkoutDistance = calculateTotalWorkoutDistance(
    workout.distance_target_meters,
    workout.workout_type,
    workout.structured_workout as Record<string, unknown> | null,
    trainingPaces
  )
  const distanceIsTotalEstimate = totalWorkoutDistance > 0 && totalWorkoutDistance !== (workout.distance_target_meters ?? 0)

  // Calculate target pace and estimated duration if we have training paces
  let targetPace: number | null = null
  let estimatedDurationMinutes: number | null = null
  let paceLabel: string | null = null

  if (trainingPaces && workout.distance_target_meters && workout.workout_type) {
    // Prefer intensity_target when it is explicitly "marathon" — this handles plans like
    // Hanson's where tempo workouts run at marathon race pace, not threshold pace.
    const paceType = workout.intensity_target?.toLowerCase().includes('marathon')
      ? 'marathon'
      : getWorkoutPaceType(workout.workout_type)
    targetPace = trainingPaces[paceType]

    // For intervals/tempo: estimate full session duration including warmup/cooldown minutes
    const sw = workout.structured_workout as Record<string, unknown> | null
    const warmupMin = (sw?.warmup as { duration_minutes?: number } | undefined)?.duration_minutes ?? 0
    const cooldownMin = (sw?.cooldown as { duration_minutes?: number } | undefined)?.duration_minutes ?? 0
    const mainSeconds = estimateDuration(workout.distance_target_meters, targetPace)
    estimatedDurationMinutes = Math.round(mainSeconds / 60) + warmupMin + cooldownMin

    paceLabel = paceType.charAt(0).toUpperCase() + paceType.slice(1)
  }

  const enterEditMode = () => {
    setEditDescription(workout.description ?? '')
    setEditDistanceDisplay(
      workout.distance_target_meters
        ? toDisplayDistance(workout.distance_target_meters).toFixed(2)
        : ''
    )
    setEditIntensity(workout.intensity_target ?? '')
    setEditDurationMinutes(
      workout.duration_target_seconds ? String(Math.round(workout.duration_target_seconds / 60)) : ''
    )

    if (hasStructuredWorkout) {
      const raw = workout.structured_workout as Record<string, unknown>
      const rawMainSet = raw.main_set
      setEditStructured({
        warmup: raw.warmup as EditableWarmupCooldown | undefined,
        main_set: Array.isArray(rawMainSet)
          ? rawMainSet.map((s: unknown) => {
              const set = s as Record<string, unknown>
              return {
                repeat: (set.repeat as number) ?? 1,
                intervals: Array.isArray(set.intervals)
                  ? (set.intervals as EditableInterval[])
                  : [],
                skip_last_recovery: (set.skip_last_recovery as boolean) ?? false,
              }
            })
          : [],
        cooldown: raw.cooldown as EditableWarmupCooldown | undefined,
      })
    } else {
      setEditStructured(null)
    }

    // Load custom pace for simple workouts
    const sw = workout.structured_workout as Record<string, unknown> | null
    if (!hasStructuredWorkout && sw?.target_pace && typeof sw.target_pace === 'string') {
      const sec = parseSinglePaceSec(sw.target_pace)
      if (sec !== null) {
        const display = units === 'imperial' ? sec * PACE_SCALE_KM_TO_MI : sec
        setEditCustomPaceM(String(Math.floor(display / 60)))
        setEditCustomPaceS(String(Math.round(display % 60)).padStart(2, '0'))
      }
    } else {
      setEditCustomPaceM('')
      setEditCustomPaceS('')
    }

    setIsEditing(true)
  }

  const cancelEdit = () => {
    if (isNew) {
      onClose?.()
    } else {
      setIsEditing(false)
    }
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const displayDist = parseFloat(editDistanceDisplay)
      const meters = !isNaN(displayDist) && displayDist > 0
        ? Math.round(units === 'imperial' ? (displayDist / KM_TO_MILES) * 1000 : displayDist * 1000)
        : null
      const durationSecs = editDurationMinutes
        ? Math.round(parseFloat(editDurationMinutes) * 60)
        : null

      let structuredWorkoutValue: Record<string, unknown> | null = null
      // Only persist structured workout if it has at least one step
      if (editStructured && editStructured.main_set.length > 0) {
        structuredWorkoutValue = editStructured as unknown as Record<string, unknown>
      } else if (editIntensity === 'custom' && editCustomPaceM && editCustomPaceS) {
        const secDisplay = (parseInt(editCustomPaceM, 10) || 0) * 60 + (parseInt(editCustomPaceS, 10) || 0)
        const secKm = units === 'imperial' ? secDisplay / PACE_SCALE_KM_TO_MI : secDisplay
        const stored = `${Math.floor(secKm / 60)}:${String(Math.round(secKm % 60)).padStart(2, '0')}`
        const existing = (workout.structured_workout ?? {}) as Record<string, unknown>
        structuredWorkoutValue = { ...existing, target_pace: stored }
      }

      if (isNew) {
        const response = await fetch('/api/workouts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scheduled_date: workout.scheduled_date,
            workout_type: editWorkoutType,
            description: editDescription || null,
            distance_target_meters: meters,
            duration_target_seconds: durationSecs,
            intensity_target: editIntensity || null,
            structured_workout: structuredWorkoutValue,
          }),
        })

        if (!response.ok) {
          const err = await response.json()
          throw new Error(err.error || 'Failed to create')
        }

        queryClient.invalidateQueries({ queryKey: ['workouts'] })
        toast.success('Workout created')
        onCreated?.()
        return
      }

      // --- Edit existing workout ---
      const updates: Record<string, unknown> = {}

      if (editDescription !== (workout.description ?? '')) {
        updates.description = editDescription
      }

      if (meters !== null) {
        if (Math.abs(meters - (workout.distance_target_meters ?? 0)) > 1) {
          updates.distance_target_meters = meters
        }
      } else if (editDistanceDisplay === '' && workout.distance_target_meters !== null) {
        updates.distance_target_meters = null
      }

      if (editIntensity !== (workout.intensity_target ?? '')) {
        updates.intensity_target = editIntensity || null
      }

      if (durationSecs !== (workout.duration_target_seconds ?? null)) {
        updates.duration_target_seconds = durationSecs
      }

      if (structuredWorkoutValue !== null) {
        updates.structured_workout = structuredWorkoutValue
      }

      if (Object.keys(updates).length === 0) {
        setIsEditing(false)
        return
      }

      const response = await fetch('/api/workouts/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workoutId: workout.id, updates }),
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Failed to save')
      }

      const { workout: updated } = await response.json()

      queryClient.invalidateQueries({ queryKey: ['workouts'] })

      toast.success('Workout saved')
      setIsEditing(false)

      if (onSaved && updated) {
        onSaved({
          ...workout,
          ...updated,
          date: workout.date,
          formatted_date: workout.formatted_date,
          phase_name: workout.phase_name,
          week_of_plan: workout.week_of_plan,
        })
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save workout'
      toast.error(message)
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Delete this workout from the plan? This cannot be undone.')) return
    setIsDeleting(true)
    try {
      const res = await fetch(`/api/workouts?id=${workout.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete workout')
      onDeleted?.()
    } catch {
      // error is surfaced via the button's disabled state reverting
    } finally {
      setIsDeleting(false)
    }
  }

  const handleReschedule = async (newDate: Date) => {
    const newDateStr = format(newDate, 'yyyy-MM-dd')
    if (newDateStr === workout.scheduled_date) {
      setDatePickerOpen(false)
      return
    }
    setIsRescheduling(true)
    try {
      const res = await fetch('/api/workouts/reschedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workoutId: workout.id, newDate: newDateStr }),
      })
      if (!res.ok) throw new Error('Failed to reschedule')
      queryClient.invalidateQueries({ queryKey: ['workouts'] })
      toast.success('Workout rescheduled')
      setDatePickerOpen(false)
      onSaved?.({
        ...workout,
        scheduled_date: newDateStr,
        date: newDate,
        formatted_date: format(newDate, 'EEE, MMM d'),
      })
    } catch {
      toast.error('Failed to reschedule workout')
    } finally {
      setIsRescheduling(false)
    }
  }

  return (
    <div className="space-y-4 pt-4">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xl font-semibold">
            {formatWorkoutType(isNew ? editWorkoutType : workout.workout_type)}
          </h3>
          <div className="flex items-center gap-2">
            {!isNew && workout.workout_index && (
              <Badge variant="outline">{workout.workout_index}</Badge>
            )}
            {editable && !isEditing && !isNew && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={enterEditMode} aria-label="Edit workout">
                    <Pencil className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Edit workout</TooltipContent>
              </Tooltip>
            )}
            {onDiscuss && !isEditing && !isNew && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-violet-500 hover:text-violet-600 hover:bg-violet-50"
                    onClick={() => onDiscuss(workout)}
                    aria-label="Discuss with AI Coach"
                  >
                    <Sparkles className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Discuss with AI Coach</TooltipContent>
              </Tooltip>
            )}
            {onDeleted && !isEditing && !isNew && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                    disabled={isDeleting}
                    onClick={handleDelete}
                    aria-label="Delete workout"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Delete workout</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          {editable ? (
            <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
              <PopoverTrigger asChild>
                <button className="flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer">
                  {isRescheduling
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Calendar className="h-4 w-4" />
                  }
                  {workout.formatted_date}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <CalendarPicker
                  mode="single"
                  selected={parseISO(workout.scheduled_date)}
                  onSelect={(date) => date && handleReschedule(date)}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          ) : (
            <div className="flex items-center gap-1">
              <Calendar className="h-4 w-4" />
              {workout.formatted_date}
            </div>
          )}
          <Badge variant="secondary">{workout.phase_name}</Badge>
        </div>
      </div>

      {/* Completion Status */}
      {workout.completion_status && workout.completion_status !== 'pending' && (
        <div className="flex items-center gap-2 text-sm">
          {workout.completion_status === 'completed' && (
            <>
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span className="text-green-600 font-medium">Completed</span>
            </>
          )}
          {workout.completion_status === 'partial' && (
            <>
              <AlertCircle className="h-4 w-4 text-yellow-500" />
              <span className="text-yellow-600 font-medium">Partial</span>
            </>
          )}
          {workout.completion_status === 'skipped' && (
            <>
              <XCircle className="h-4 w-4 text-red-500" />
              <span className="text-red-600 font-medium">Skipped</span>
            </>
          )}

          {workout.completion_metadata?.distance_variance_percent !== undefined &&
           Math.abs(workout.completion_metadata.distance_variance_percent) > 10 && (
            <span className="text-xs text-muted-foreground">
              ({workout.completion_metadata.distance_variance_percent > 0 ? '+' : ''}
              {workout.completion_metadata.distance_variance_percent.toFixed(0)}%)
            </span>
          )}
        </div>
      )}

      <Separator />

      {/* Validation Warning */}
      {workout.validation_warning && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-2">
          <div className="flex items-start gap-2">
            <Flag className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1 space-y-1">
              <p className="text-sm font-medium text-red-900">
                ⚠️ Possible LLM Hallucination
              </p>
              <p className="text-xs text-red-800">
                This workout has an unusual distance that may be due to an AI calculation error.
              </p>
              <p className="text-xs text-red-700 font-mono">
                Distance: {formatDistance(workout.validation_warning.actualDistance, 1)}
                (expected: {formatDistance(workout.validation_warning.expectedRange.min, 1)}-
                {formatDistance(workout.validation_warning.expectedRange.max, 1)} for {workout.workout_type})
              </p>
              {editable && !isEditing && (
                <div className="flex items-center gap-1 mt-2">
                  <RotateCcw className="h-3 w-3 text-red-600" />
                  <p className="text-xs text-red-700 font-medium">
                    Click the pencil icon to correct the distance
                  </p>
                </div>
              )}
              {!editable && (
                <div className="flex items-center gap-1 mt-2">
                  <RotateCcw className="h-3 w-3 text-red-600" />
                  <p className="text-xs text-red-700 font-medium">
                    Consider regenerating the plan if this looks incorrect
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* READ MODE                                                           */}
      {/* ================================================================== */}
      {!isEditing && (
        <>
          {workout.description && (
            <div>
              <p className="text-sm text-muted-foreground">{workout.description}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            {workout.distance_target_meters && (
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Target className="h-4 w-4" />
                  {distanceIsTotalEstimate ? 'Approx. distance' : 'Distance Target'}
                </div>
                <div className="text-lg font-medium">
                  {formatDistance(distanceIsTotalEstimate ? totalWorkoutDistance : workout.distance_target_meters, 1)}
                </div>
              </div>
            )}

            {workout.intensity_target && (
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <TrendingUp className="h-4 w-4" />
                  Intensity
                </div>
                <Badge>{workout.intensity_target}</Badge>
              </div>
            )}

            {targetPace !== null && (
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Gauge className="h-4 w-4" />
                  {paceLabel} Pace
                </div>
                <div className="text-lg font-medium">
                  {formatPace(targetPace!)}
                </div>
                {vdot && (
                  <div className="text-xs text-muted-foreground">
                    VDOT {vdot}
                  </div>
                )}
              </div>
            )}

            {estimatedDurationMinutes !== null && (
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  Estimated Duration
                </div>
                <div className="text-lg font-medium">
                  {estimatedDurationMinutes} min
                </div>
              </div>
            )}
          </div>

          {hasStructuredWorkout && (
            <>
              <Separator />
              <div>
                <h4 className="font-medium mb-2">Workout Structure</h4>
                <div className="text-sm space-y-1">
                  {renderStructuredWorkout(workout.structured_workout as StructuredBlob, units)}
                </div>
              </div>
            </>
          )}

          <div className="flex gap-2 pt-2">
            {onClose && (
              <Button onClick={onClose} variant="outline">
                Close
              </Button>
            )}
            {garminConnected && onSendToGarmin && workout.workout_type !== 'rest' && (
              <Button
                variant="outline"
                disabled={isSendingToGarmin || isRemovingFromGarmin}
                onClick={async () => {
                  setIsSendingToGarmin(true)
                  try {
                    await onSendToGarmin(workout.id)
                  } finally {
                    setIsSendingToGarmin(false)
                  }
                }}
              >
                {isSendingToGarmin ? 'Sending...' : 'Send to Garmin'}
              </Button>
            )}
            {garminConnected && onRemoveFromGarmin && workout.garmin_workout_id && workout.workout_type !== 'rest' && (
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive"
                disabled={isRemovingFromGarmin || isSendingToGarmin}
                onClick={async () => {
                  setIsRemovingFromGarmin(true)
                  try {
                    await onRemoveFromGarmin(workout.id)
                  } finally {
                    setIsRemovingFromGarmin(false)
                  }
                }}
              >
                {isRemovingFromGarmin ? 'Removing...' : 'Remove from Garmin'}
              </Button>
            )}
          </div>
        </>
      )}

      {/* ================================================================== */}
      {/* EDIT MODE                                                           */}
      {/* ================================================================== */}
      {isEditing && (
        <>
          <div className="space-y-4">
            {isNew && (
              <div className="space-y-1.5">
                <Label className="text-sm">Workout Type</Label>
                <Select
                  value={editWorkoutType}
                  onValueChange={v => setEditWorkoutType(v as typeof editWorkoutType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WORKOUT_TYPES.map(t => (
                      <SelectItem key={t} value={t}>{formatWorkoutType(t)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-sm">Description</Label>
              <Input
                value={editDescription}
                onChange={e => setEditDescription(e.target.value)}
                placeholder="Workout description"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className={`text-sm ${editStructured ? 'text-muted-foreground' : ''}`}>
                  Distance ({distanceLabel()})
                </Label>
                <Input
                  type="number"
                  min={0}
                  step={0.1}
                  value={editDistanceDisplay}
                  onChange={e => setEditDistanceDisplay(e.target.value)}
                  placeholder="e.g. 10"
                  disabled={!!editStructured}
                />
              </div>

              <div className="space-y-1.5">
                <Label className={`text-sm ${editStructured ? 'text-muted-foreground' : ''}`}>Intensity</Label>
                <Select
                  value={editIntensity}
                  onValueChange={setEditIntensity}
                  disabled={!!editStructured}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select intensity" />
                  </SelectTrigger>
                  <SelectContent>
                    {INTENSITY_OPTIONS.map(opt => (
                      <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className={`text-sm ${editStructured ? 'text-muted-foreground' : ''}`}>Duration (minutes)</Label>
                <Input
                  type="number"
                  min={0}
                  value={editDurationMinutes}
                  onChange={e => setEditDurationMinutes(e.target.value)}
                  placeholder="e.g. 60"
                  disabled={!!editStructured}
                />
              </div>

              {/* Pace range preview — col 2, row 2; only for simple (non-structured) workouts */}
              {!editStructured && (
                <div className="space-y-1.5">
                  <Label className="text-sm text-muted-foreground">Pace range</Label>
                  <div className="h-9 flex items-center">
                    {editPaceRangeStr
                      ? <span className="font-mono text-sm">{editPaceRangeStr}</span>
                      : <span className="text-sm text-muted-foreground">—</span>
                    }
                  </div>
                </div>
              )}

              {/* Custom pace — only for simple (non-structured) workouts */}
              {editIntensity === 'custom' && !editStructured && (
                <div className="space-y-1.5 col-span-2">
                  <Label className="text-sm">Pace ({units === 'imperial' ? 'min/mi' : 'min/km'})</Label>
                  <div className="flex items-center gap-1">
                    <Input
                      type="number" min={0} max={99} placeholder="M"
                      className="h-9 w-12 text-sm text-center px-1"
                      value={editCustomPaceM}
                      onChange={e => setEditCustomPaceM(e.target.value)}
                    />
                    <span className="text-sm font-mono text-muted-foreground">:</span>
                    <Input
                      type="number" min={0} max={59} placeholder="SS"
                      className="h-9 w-14 text-sm text-center px-1"
                      value={editCustomPaceS}
                      onChange={e => setEditCustomPaceS(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>

            <Separator />
            {editStructured ? (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-medium text-sm">Workout Structure</h4>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs text-muted-foreground"
                    onClick={() => setEditStructured(null)}
                  >
                    Remove structure
                  </Button>
                </div>
                <StructuredWorkoutEditor
                  structured={editStructured}
                  onChange={setEditStructured}
                  trainingPaces={trainingPaces}
                  units={units}
                />
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="text-xs w-full"
                onClick={() => setEditStructured({ main_set: [] })}
              >
                <Plus className="h-3 w-3 mr-1" />
                Add workout structure
              </Button>
            )}
          </div>

          <div className="flex gap-2 pt-2">
            <Button onClick={handleSave} disabled={isSaving} className="flex-1">
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
            <Button onClick={cancelEdit} variant="outline" disabled={isSaving}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

// ============================================================================
// Read-only structured workout renderer
// ============================================================================

// Loose type for the structured_workout JSON blob from the database
type StructuredBlob = Record<string, unknown>

function renderStructuredWorkout(structure: StructuredBlob, units: UnitSystem = 'metric'): React.ReactNode {
  if (!structure) return null

  const parts: string[] = []

  if (structure.warmup) {
    parts.push(`Warmup: ${formatWorkoutPart(structure.warmup as StructuredBlob, units)}`)
  }

  if (structure.main_set) {
    if (Array.isArray(structure.main_set)) {
      structure.main_set.forEach((s: unknown, i: number) => {
        const set = s as StructuredBlob
        if (set.repeat && set.intervals && Array.isArray(set.intervals)) {
          const intervals = set.intervals.map((int: unknown) => formatInterval(int as StructuredBlob)).join(', ')
          parts.push(`Set ${i + 1}: ${set.repeat}x (${intervals})`)
        }
      })
    } else {
      parts.push(`Main: ${formatWorkoutPart(structure.main_set as StructuredBlob, units)}`)
    }
  }

  if (structure.cooldown) {
    parts.push(`Cooldown: ${formatWorkoutPart(structure.cooldown as StructuredBlob, units)}`)
  }

  return (
    <div className="space-y-1">
      {parts.map((part, i) => (
        <div key={i} className="text-muted-foreground">{part}</div>
      ))}
    </div>
  )
}

function formatWorkoutPart(part: StructuredBlob, units: UnitSystem = 'metric'): string {
  const details: string[] = []
  if (part.duration_minutes) details.push(`${part.duration_minutes}min`)
  if (part.distance_meters) details.push(fmtDist(part.distance_meters as number, units, 1))
  if (part.intensity) details.push(part.intensity as string)
  if (part.target_pace) details.push(`@ ${part.target_pace}`)
  return details.join(' ')
}

function formatInterval(interval: StructuredBlob): string {
  const parts: string[] = []
  if (interval.distance_meters) parts.push(`${interval.distance_meters}m`)
  if (interval.duration_seconds) parts.push(`${interval.duration_seconds}s`)
  if (interval.target_pace) parts.push(`@ ${interval.target_pace}`)
  if (interval.intensity) parts.push(interval.intensity as string)
  return parts.join(' ')
}
