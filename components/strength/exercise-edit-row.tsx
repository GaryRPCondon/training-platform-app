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
import { useTranslations } from 'next-intl'
import type { StrengthExercise } from '@/types/database'

export function makeBlankExercise(displayName = 'New exercise'): StrengthExercise {
  return {
    canonical_name: 'new_exercise',
    display_name: displayName,
    user_text: displayName,
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
  const t = useTranslations('strengthExercise')
  const m = exercise.measurement
  return (
    <div className="space-y-2 rounded-md border border-border/60 px-3 py-2">
      <div className="flex items-start gap-2">
        <Input
          value={exercise.display_name}
          onChange={e => onChange({ display_name: e.target.value })}
          placeholder={t('exerciseNamePlaceholder')}
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
              aria-label={t('removeExercise')}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{canDelete ? t('remove') : t('atLeastOne')}</TooltipContent>
        </Tooltip>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <div>
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('typeLabel')}</Label>
          <Select value={m.type} onValueChange={v => onTypeChange(v as StrengthExercise['measurement']['type'])}>
            <SelectTrigger className="h-8 mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="reps">{t('typeReps')}</SelectItem>
              <SelectItem value="duration">{t('typeDuration')}</SelectItem>
              <SelectItem value="distance">{t('typeDistance')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('setsLabel')}</Label>
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
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('repsLabel')}</Label>
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
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('secondsLabel')}</Label>
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
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('metresLabel')}</Label>
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
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('weightLabel')}</Label>
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
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('restLabel')}</Label>
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
        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('notesLabel')}</Label>
        <Input
          value={exercise.notes ?? ''}
          onChange={e => onChange({ notes: e.target.value || undefined })}
          placeholder={t('notesPlaceholder')}
          className="h-8 mt-1"
        />
      </div>
    </div>
  )
}
