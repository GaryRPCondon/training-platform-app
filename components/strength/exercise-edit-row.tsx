'use client'

import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { StrengthExercise } from '@/types/database'

export function makeBlankExercise(): StrengthExercise {
  return {
    canonical_name: 'new_exercise',
    display_name: 'New exercise',
    user_text: 'New exercise',
    measurement: { type: 'reps', sets: 3, reps_per_set: 10 },
    garmin_supported: false,
  }
}

function parseNumber(v: string): number | undefined {
  if (v.trim() === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

export interface ExerciseEditRowProps {
  exercise: StrengthExercise
  canDelete: boolean
  onChange: (patch: Partial<StrengthExercise>) => void
  onMeasurementChange: (patch: Partial<StrengthExercise['measurement']>) => void
  onTypeChange: (type: StrengthExercise['measurement']['type']) => void
  onDelete: () => void
}

export function ExerciseEditRow({ exercise, canDelete, onChange, onMeasurementChange, onTypeChange, onDelete }: ExerciseEditRowProps) {
  const m = exercise.measurement
  return (
    <div className="space-y-2 rounded-md border border-border/60 px-3 py-2">
      <div className="flex items-start gap-2">
        <Input
          value={exercise.display_name}
          onChange={e => onChange({ display_name: e.target.value })}
          placeholder="Exercise name"
          className="h-8"
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={onDelete}
              disabled={!canDelete}
              aria-label="Remove exercise"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{canDelete ? 'Remove' : 'At least one exercise is required'}</TooltipContent>
        </Tooltip>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <div>
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Type</Label>
          <Select value={m.type} onValueChange={v => onTypeChange(v as StrengthExercise['measurement']['type'])}>
            <SelectTrigger className="h-8 mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="reps">Reps</SelectItem>
              <SelectItem value="duration">Duration</SelectItem>
              <SelectItem value="distance">Distance</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Sets</Label>
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            className="h-8 mt-1"
            value={m.sets}
            onChange={e => {
              const n = parseNumber(e.target.value)
              if (n !== undefined && n >= 1) onMeasurementChange({ sets: Math.floor(n) })
            }}
          />
        </div>
        {m.type === 'reps' && (
          <div>
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Reps</Label>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              className="h-8 mt-1"
              value={m.reps_per_set ?? ''}
              onChange={e => {
                const n = parseNumber(e.target.value)
                onMeasurementChange({ reps_per_set: n !== undefined ? Math.floor(n) : undefined })
              }}
            />
          </div>
        )}
        {m.type === 'duration' && (
          <div>
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Seconds</Label>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              className="h-8 mt-1"
              value={m.duration_seconds ?? ''}
              onChange={e => {
                const n = parseNumber(e.target.value)
                onMeasurementChange({ duration_seconds: n !== undefined ? Math.floor(n) : undefined })
              }}
            />
          </div>
        )}
        {m.type === 'distance' && (
          <div>
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Metres</Label>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              className="h-8 mt-1"
              value={m.distance_meters ?? ''}
              onChange={e => {
                const n = parseNumber(e.target.value)
                onMeasurementChange({ distance_meters: n !== undefined ? Math.floor(n) : undefined })
              }}
            />
          </div>
        )}
        {m.type === 'reps' && (
          <div>
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Weight (kg)</Label>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step={0.5}
              className="h-8 mt-1"
              value={m.weight_kg ?? ''}
              onChange={e => {
                const n = parseNumber(e.target.value)
                onMeasurementChange({ weight_kg: n ?? null })
              }}
            />
          </div>
        )}
        <div>
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Rest (s)</Label>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            className="h-8 mt-1"
            value={m.rest_seconds ?? ''}
            onChange={e => {
              const n = parseNumber(e.target.value)
              onMeasurementChange({ rest_seconds: n !== undefined ? Math.floor(n) : undefined })
            }}
          />
        </div>
      </div>
      <div>
        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Notes</Label>
        <Input
          value={exercise.notes ?? ''}
          onChange={e => onChange({ notes: e.target.value || undefined })}
          placeholder="Optional cue or coaching note"
          className="h-8 mt-1"
        />
      </div>
    </div>
  )
}
