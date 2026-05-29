'use client'

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { getAthleteProfile } from '@/lib/supabase/queries'
import {
  Dumbbell,
  Sparkles,
  Trash2,
  Watch,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Circle,
  Loader2,
  CalendarDays,
  Check,
  X,
  Pencil,
  Plus,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import { ExerciseEditRow, makeBlankExercise } from '@/components/strength/exercise-edit-row'
import type { StrengthSession, StrengthExercise } from '@/types/database'

interface SessionDetailDialogProps {
  session: StrengthSession
  onSaved?: (updated: StrengthSession) => void
  onDeleted?: () => void
  onClose?: () => void
}

const GARMIN_STATUS_LABELS: Record<NonNullable<StrengthSession['garmin_sync_status']>, { label: string; tone: string }> = {
  synced:      { label: 'Synced to Garmin',    tone: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-900' },
  stale:       { label: 'Garmin sync out of date', tone: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-900' },
  failed:      { label: 'Garmin sync failed',  tone: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-200 dark:border-red-900' },
  unsupported: { label: 'Garmin: unsupported', tone: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-800' },
}

type CompletionStatus = StrengthSession['completion_status']

const STATUS_OPTIONS: Array<{ value: CompletionStatus; label: string; icon: typeof Circle }> = [
  { value: 'pending', label: 'Pending', icon: Circle },
  { value: 'completed', label: 'Completed', icon: CheckCircle2 },
  { value: 'partial', label: 'Partial', icon: AlertCircle },
  { value: 'skipped', label: 'Skipped', icon: XCircle },
]

function formatMeasurement(ex: StrengthExercise): string {
  const m = ex.measurement
  if (m.type === 'reps' && m.reps_per_set !== undefined) {
    const weight = m.weight_kg != null ? ` @ ${m.weight_kg}kg` : ''
    return `${m.sets} × ${m.reps_per_set}${weight}`
  }
  if (m.type === 'duration' && m.duration_seconds !== undefined) {
    return `${m.sets} × ${m.duration_seconds}s`
  }
  if (m.type === 'distance' && m.distance_meters !== undefined) {
    return `${m.sets} × ${m.distance_meters}m`
  }
  return `${m.sets} sets`
}

export function SessionDetailDialog({ session, onSaved, onDeleted, onClose }: SessionDetailDialogProps) {
  const router = useRouter()
  const [status, setStatus] = useState<CompletionStatus>(session.completion_status)
  const [durationMin, setDurationMin] = useState<string>(
    session.actual_duration_minutes != null ? String(session.actual_duration_minutes) : '',
  )
  const [notes, setNotes] = useState<string>(session.completion_notes ?? '')
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [isSendingGarmin, setIsSendingGarmin] = useState(false)
  const [isRemovingGarmin, setIsRemovingGarmin] = useState(false)
  const [isEditingDate, setIsEditingDate] = useState(false)
  const [draftDate, setDraftDate] = useState(session.scheduled_date)
  const [isRescheduling, setIsRescheduling] = useState(false)
  const [isEditingExercises, setIsEditingExercises] = useState(false)
  const [draftExercises, setDraftExercises] = useState<StrengthExercise[]>(session.exercises)
  const [isSavingExercises, setIsSavingExercises] = useState(false)

  const { data: athlete } = useQuery({
    queryKey: ['athlete'],
    queryFn: getAthleteProfile,
    staleTime: 60_000,
  })
  const garminConnected = !!athlete?.garmin_connected

  // Per Stage 2.5, every exercise can be sent — unsupported ones become
  // generic-fallback or label-only steps. `unsupportedNames` is now a list of
  // exercises that won't render with a real Garmin label on the watch.
  const allGarminSupported = session.exercises.length > 0 && session.exercises.every(e => e.garmin_supported)
  const unsupportedNames = session.exercises.filter(e => !e.garmin_supported).map(e => e.display_name)
  const hasUnsupported = unsupportedNames.length > 0
  const garminStatus = session.garmin_sync_status
  const isSynced = !!session.garmin_workout_id && garminStatus === 'synced'

  const hasChanges =
    status !== session.completion_status ||
    notes !== (session.completion_notes ?? '') ||
    (durationMin === '' ? session.actual_duration_minutes != null : Number(durationMin) !== (session.actual_duration_minutes ?? null))

  const handleSave = async () => {
    setIsSaving(true)
    const parsedDuration = durationMin === '' ? null : Number(durationMin)
    if (durationMin !== '' && (!Number.isFinite(parsedDuration) || (parsedDuration as number) < 0)) {
      toast.error('Duration must be a non-negative number')
      setIsSaving(false)
      return
    }
    try {
      const res = await fetch(`/api/strength/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          completion_status: status,
          actual_duration_minutes: parsedDuration,
          completion_notes: notes.trim() === '' ? null : notes,
        }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to update session')
      toast.success('Session updated')
      onSaved?.(result.session as StrengthSession)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update session')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    setIsDeleting(true)
    try {
      const res = await fetch(`/api/strength/sessions/${session.id}`, { method: 'DELETE' })
      const result = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(result.error || 'Failed to delete session')
      toast.success('Session deleted')
      setIsDeleteOpen(false)
      onDeleted?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete session')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleDiscuss = () => {
    onClose?.()
    router.push(`/dashboard/chat?strengthSessionId=${session.id}`)
  }

  const handleReschedule = async () => {
    if (draftDate === session.scheduled_date) {
      setIsEditingDate(false)
      return
    }
    setIsRescheduling(true)
    try {
      const res = await fetch('/api/strength/reschedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id, newDate: draftDate }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to reschedule')
      const dateLabel = format(parseISO(draftDate), 'EEE, MMM d')
      const wasOnGarmin = !!session.garmin_workout_id && session.garmin_sync_status === 'synced'
      if (wasOnGarmin && result.garminMoved) {
        toast.success(`Moved to ${dateLabel} (Garmin updated)`)
      } else if (wasOnGarmin && !result.garminMoved) {
        toast.warning(`Moved to ${dateLabel}. Couldn't update Garmin — resend manually.`)
      } else {
        toast.success(`Moved to ${dateLabel}`)
      }
      setIsEditingDate(false)
      onSaved?.(result.session as StrengthSession)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reschedule')
    } finally {
      setIsRescheduling(false)
    }
  }

  const handleSendToGarmin = async () => {
    setIsSendingGarmin(true)
    try {
      const res = await fetch('/api/garmin/strength-workouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionIds: [session.id], action: 'send' }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to send')
      if (result.sent > 0) {
        toast.success('Sent to Garmin')
        onSaved?.({ ...session, garmin_sync_status: 'synced' })
      } else if (result.skipped > 0) {
        toast.error(result.errors?.[0]?.error || 'Session contains unsupported exercises')
      } else if (result.failed > 0) {
        toast.error(result.errors?.[0]?.error || 'Failed to send to Garmin')
      } else {
        toast.error('No sessions were sent')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send to Garmin')
    } finally {
      setIsSendingGarmin(false)
    }
  }

  const handleRemoveFromGarmin = async () => {
    setIsRemovingGarmin(true)
    try {
      const res = await fetch('/api/garmin/strength-workouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionIds: [session.id], action: 'delete' }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to remove')
      if (result.deleted > 0) {
        toast.success('Removed from Garmin')
        onSaved?.({
          ...session,
          garmin_workout_id: null,
          garmin_sync_status: null,
          garmin_scheduled_at: null,
        })
      } else {
        toast.error(result.errors?.[0]?.error || 'Nothing to remove')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove from Garmin')
    } finally {
      setIsRemovingGarmin(false)
    }
  }

  const enterEditExercises = () => {
    setDraftExercises(session.exercises.map(ex => ({ ...ex, measurement: { ...ex.measurement } })))
    setIsEditingExercises(true)
  }

  const cancelEditExercises = () => {
    setDraftExercises(session.exercises)
    setIsEditingExercises(false)
  }

  const updateDraftAt = (idx: number, patch: Partial<StrengthExercise>) => {
    setDraftExercises(prev => prev.map((ex, i) => (i === idx ? { ...ex, ...patch } : ex)))
  }

  const updateDraftMeasurement = (idx: number, patch: Partial<StrengthExercise['measurement']>) => {
    setDraftExercises(prev => prev.map((ex, i) => {
      if (i !== idx) return ex
      return { ...ex, measurement: { ...ex.measurement, ...patch } }
    }))
  }

  const changeMeasurementType = (idx: number, type: StrengthExercise['measurement']['type']) => {
    setDraftExercises(prev => prev.map((ex, i) => {
      if (i !== idx) return ex
      const base = { type, sets: ex.measurement.sets }
      if (type === 'reps') return { ...ex, measurement: { ...base, reps_per_set: ex.measurement.reps_per_set ?? 10 } }
      if (type === 'duration') return { ...ex, measurement: { ...base, duration_seconds: ex.measurement.duration_seconds ?? 30 } }
      return { ...ex, measurement: { ...base, distance_meters: ex.measurement.distance_meters ?? 100 } }
    }))
  }

  const removeDraftAt = (idx: number) => {
    setDraftExercises(prev => prev.filter((_, i) => i !== idx))
  }

  const addDraftExercise = () => {
    setDraftExercises(prev => [...prev, makeBlankExercise()])
  }

  const saveExercises = async () => {
    if (draftExercises.length === 0) {
      toast.error('At least one exercise is required')
      return
    }
    setIsSavingExercises(true)
    try {
      // Mirror the LLM-emitted shape: canonical_name + user_text track display_name
      // for user-added rows so the catalog re-stamp on the server has something to
      // match against.
      const payload = draftExercises.map(ex => ({
        ...ex,
        canonical_name: ex.canonical_name?.trim() || ex.display_name.trim().toLowerCase().replace(/\s+/g, '_'),
        user_text: ex.user_text?.trim() || ex.display_name,
      }))
      const res = await fetch(`/api/strength/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exercises: payload }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to update exercises')
      toast.success('Exercises updated')
      setIsEditingExercises(false)
      onSaved?.(result.session as StrengthSession)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update exercises')
    } finally {
      setIsSavingExercises(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col pt-2">
      <div className="shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2">
            <Dumbbell className="mt-1 h-5 w-5 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <h3 className="text-xl font-semibold">{session.title}</h3>
              {session.program_name && (
                <div className="text-xs text-muted-foreground">
                  from <span className="font-medium">{session.program_name}</span>
                </div>
              )}
              {isEditingDate ? (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Input
                    type="date"
                    value={draftDate}
                    onChange={(e) => setDraftDate(e.target.value)}
                    className="h-8 w-auto"
                    disabled={isRescheduling}
                  />
                  <Button size="sm" variant="ghost" onClick={handleReschedule} disabled={isRescheduling} aria-label="Save date">
                    {isRescheduling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => { setDraftDate(session.scheduled_date); setIsEditingDate(false) }}
                    disabled={isRescheduling}
                    aria-label="Cancel"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span>{format(parseISO(session.scheduled_date), 'EEEE, MMM d')}</span>
                  {session.estimated_duration_minutes != null && (
                    <span>· ~{session.estimated_duration_minutes} min planned</span>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-foreground"
                        onClick={() => { setDraftDate(session.scheduled_date); setIsEditingDate(true) }}
                        aria-label="Reschedule"
                      >
                        <CalendarDays className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Reschedule</TooltipContent>
                  </Tooltip>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-violet-500 hover:bg-violet-50 hover:text-violet-600 dark:hover:bg-violet-950"
                  onClick={handleDiscuss}
                  aria-label="Discuss with AI Coach"
                >
                  <Sparkles className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Discuss with AI Coach</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setIsDeleteOpen(true)}
                  disabled={isDeleting}
                  aria-label="Delete session"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete session</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>

      <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
      {(session.placement_rationale || session.coaching_note) && (
        <div className="space-y-2">
          {session.placement_rationale && (
            <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Why this day: </span>
              {session.placement_rationale}
            </div>
          )}
          {session.coaching_note && (
            <div className="text-xs italic text-muted-foreground">{session.coaching_note}</div>
          )}
        </div>
      )}

      <Separator />

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Exercises
          </h4>
          <div className="flex items-center gap-2">
            {!isEditingExercises && session.exercises.length > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant={allGarminSupported ? 'default' : 'secondary'} className="cursor-help text-xs">
                    <Watch className="mr-1 h-3 w-3" />
                    {allGarminSupported
                      ? 'All Garmin-ready'
                      : `${unsupportedNames.length} as fallback`}
                  </Badge>
                </TooltipTrigger>
                {hasUnsupported && (
                  <TooltipContent className="max-w-xs text-xs">
                    <div className="font-medium">Sent as fallback to Garmin:</div>
                    <div className="mt-0.5 text-muted-foreground">{unsupportedNames.join(', ')}</div>
                    <div className="mt-1 text-muted-foreground">These will appear on the watch using a close-enough Garmin exercise label, or as a generic step with the exercise name in the description.</div>
                  </TooltipContent>
                )}
              </Tooltip>
            )}
            {isEditingExercises ? (
              <>
                <Button size="sm" variant="ghost" onClick={cancelEditExercises} disabled={isSavingExercises}>
                  Cancel
                </Button>
                <Button size="sm" onClick={saveExercises} disabled={isSavingExercises}>
                  {isSavingExercises && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save exercises
                </Button>
              </>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={enterEditExercises}
                    aria-label="Edit exercises"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Edit exercises</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
        {isEditingExercises ? (
          <div className="space-y-2">
            {draftExercises.map((ex, i) => (
              <ExerciseEditRow
                key={i}
                exercise={ex}
                canDelete={draftExercises.length > 1}
                onChange={patch => updateDraftAt(i, patch)}
                onMeasurementChange={patch => updateDraftMeasurement(i, patch)}
                onTypeChange={t => changeMeasurementType(i, t)}
                onDelete={() => removeDraftAt(i)}
              />
            ))}
            <Button variant="outline" size="sm" onClick={addDraftExercise} className="w-full">
              <Plus className="mr-2 h-4 w-4" />
              Add exercise
            </Button>
          </div>
        ) : (
          <ul className="space-y-2">
            {session.exercises.map((ex, i) => (
              <li key={i} className="grid grid-cols-[1fr_auto] items-start gap-3 rounded-md border border-border/60 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">{ex.display_name}</div>
                  {ex.notes && <div className="mt-0.5 text-xs text-muted-foreground">{ex.notes}</div>}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="whitespace-nowrap text-xs text-muted-foreground">{formatMeasurement(ex)}</span>
                  {!ex.garmin_supported && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge variant="outline" className="cursor-help text-[10px]">Fallback</Badge>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs text-xs">
                        No exact Garmin match. Will send as a close-enough Garmin exercise, or as a generic step with the exercise name shown in the description.
                        {ex.garmin_unsupported_reason && (
                          <div className="mt-1 text-muted-foreground">{ex.garmin_unsupported_reason}</div>
                        )}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Separator />

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="strength-status" className="text-xs">Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as CompletionStatus)}>
              <SelectTrigger id="strength-status" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map(opt => {
                  const Icon = opt.icon
                  return (
                    <SelectItem key={opt.value} value={opt.value}>
                      <span className="flex items-center gap-2">
                        <Icon className="h-3.5 w-3.5" />
                        {opt.label}
                      </span>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="strength-duration" className="text-xs">Actual duration (min)</Label>
            <Input
              id="strength-duration"
              type="number"
              inputMode="numeric"
              min={0}
              value={durationMin}
              onChange={(e) => setDurationMin(e.target.value)}
              placeholder={
                session.estimated_duration_minutes != null
                  ? String(session.estimated_duration_minutes)
                  : 'e.g. 35'
              }
              className="mt-1"
            />
          </div>
        </div>
        <div>
          <Label htmlFor="strength-notes" className="text-xs">Notes</Label>
          <Textarea
            id="strength-notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="How did it go? Anything to remember next time?"
            className="mt-1 resize-none"
          />
        </div>
      </div>
      </div>

      <Separator className="mt-4 shrink-0" />

      <div className="mt-4 flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {garminStatus && GARMIN_STATUS_LABELS[garminStatus] && (
            <Badge variant="outline" className={`text-[10px] ${GARMIN_STATUS_LABELS[garminStatus].tone}`}>
              {GARMIN_STATUS_LABELS[garminStatus].label}
            </Badge>
          )}
          {garminConnected ? (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={session.exercises.length === 0 || isSendingGarmin}
                      onClick={handleSendToGarmin}
                      aria-label={isSynced ? 'Resend to Garmin' : 'Send to Garmin'}
                    >
                      {isSendingGarmin
                        ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        : <Watch className="mr-2 h-4 w-4" />}
                      {isSynced ? 'Resend to Garmin' : 'Send to Garmin'}
                    </Button>
                  </span>
                </TooltipTrigger>
                {hasUnsupported && (
                  <TooltipContent className="max-w-xs text-xs">
                    <div className="font-medium">Will send all {session.exercises.length} exercise{session.exercises.length === 1 ? '' : 's'}.</div>
                    <div className="mt-0.5 text-muted-foreground">
                      {unsupportedNames.length} as fallback or label-only: {unsupportedNames.join(', ')}
                    </div>
                  </TooltipContent>
                )}
              </Tooltip>
              {!!session.garmin_workout_id && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRemoveFromGarmin}
                  disabled={isRemovingGarmin}
                >
                  {isRemovingGarmin && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Remove from Garmin
                </Button>
              )}
            </>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button variant="outline" size="sm" disabled aria-label="Garmin not connected">
                    <Watch className="mr-2 h-4 w-4" />
                    Send to Garmin
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                Connect Garmin in Settings to enable strength workout sync.
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          )}
          <Button size="sm" onClick={handleSave} disabled={!hasChanges || isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </div>
      </div>

      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this strength session?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the session from the calendar. The parent program stays intact.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                handleDelete()
              }}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
