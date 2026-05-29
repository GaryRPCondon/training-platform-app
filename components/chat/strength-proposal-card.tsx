'use client'

import { useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Loader2, Plus, X, Check, Dumbbell } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { ExerciseEditRow, makeBlankExercise } from '@/components/strength/exercise-edit-row'
import type { StrengthSessionProposal } from '@/lib/agent/coach-tools'
import type { StrengthSession, StrengthExercise } from '@/types/database'

interface StrengthProposalCardProps {
    proposal: StrengthSessionProposal
    messageId: number
    proposalIndex: number
    onStatusChange?: (proposalIndex: number, status: 'applied' | 'dismissed') => void
}

// The LLM proposal carries only display_name + measurement + notes. Fill in
// the StrengthExercise shape with safe defaults so the row component can
// render — the server re-stamps catalog/Garmin fields on apply.
function hydrateProposalExercise(p: StrengthSessionProposal['exercises'][number]): StrengthExercise {
    return {
        canonical_name: p.display_name.trim().toLowerCase().replace(/\s+/g, '_'),
        display_name: p.display_name,
        user_text: p.display_name,
        measurement: { ...p.measurement },
        garmin_supported: false,
        notes: p.notes,
    }
}

export function StrengthProposalCard({ proposal, messageId, proposalIndex, onStatusChange }: StrengthProposalCardProps) {
    const [status, setStatus] = useState(proposal.proposal_status ?? 'pending')
    const [isApplying, setIsApplying] = useState(false)
    const [session, setSession] = useState<StrengthSession | null>(null)
    const [sessionError, setSessionError] = useState<string | null>(null)
    const [draft, setDraft] = useState<StrengthExercise[]>(proposal.exercises.map(hydrateProposalExercise))

    useEffect(() => {
        let cancelled = false
        async function loadSession() {
            try {
                const res = await fetch(`/api/strength/sessions/${proposal.session_id}`)
                if (!res.ok) {
                    if (cancelled) return
                    setSessionError(res.status === 404 ? 'Session no longer exists' : 'Failed to load session')
                    return
                }
                const data = await res.json()
                if (!cancelled) setSession(data.session as StrengthSession)
            } catch {
                if (!cancelled) setSessionError('Failed to load session')
            }
        }
        loadSession()
        return () => { cancelled = true }
    }, [proposal.session_id])

    async function persistStatus(newStatus: 'applied' | 'dismissed') {
        try {
            await fetch('/api/agent/coach', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messageId, proposalIndex, status: newStatus, proposalKind: 'strength' }),
            })
        } catch {
            // Non-critical
        }
    }

    function applyStatus(newStatus: 'applied' | 'dismissed') {
        setStatus(newStatus)
        onStatusChange?.(proposalIndex, newStatus)
        persistStatus(newStatus)
    }

    const updateDraftAt = (idx: number, patch: Partial<StrengthExercise>) => {
        setDraft(prev => prev.map((ex, i) => (i === idx ? { ...ex, ...patch } : ex)))
    }
    const updateDraftMeasurement = (idx: number, patch: Partial<StrengthExercise['measurement']>) => {
        setDraft(prev => prev.map((ex, i) => i === idx ? { ...ex, measurement: { ...ex.measurement, ...patch } } : ex))
    }
    const changeMeasurementType = (idx: number, type: StrengthExercise['measurement']['type']) => {
        setDraft(prev => prev.map((ex, i) => {
            if (i !== idx) return ex
            const base = { type, sets: ex.measurement.sets }
            if (type === 'reps') return { ...ex, measurement: { ...base, reps_per_set: ex.measurement.reps_per_set ?? 10 } }
            if (type === 'duration') return { ...ex, measurement: { ...base, duration_seconds: ex.measurement.duration_seconds ?? 30 } }
            return { ...ex, measurement: { ...base, distance_meters: ex.measurement.distance_meters ?? 100 } }
        }))
    }
    const removeDraftAt = (idx: number) => setDraft(prev => prev.filter((_, i) => i !== idx))
    const addDraftExercise = () => setDraft(prev => [...prev, makeBlankExercise()])

    async function handleApply() {
        if (draft.length === 0) {
            toast.error('At least one exercise is required')
            return
        }
        setIsApplying(true)
        try {
            const payload = draft.map(ex => ({
                ...ex,
                canonical_name: ex.canonical_name?.trim() || ex.display_name.trim().toLowerCase().replace(/\s+/g, '_'),
                user_text: ex.user_text?.trim() || ex.display_name,
            }))
            const res = await fetch(`/api/strength/sessions/${proposal.session_id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ exercises: payload }),
            })
            const result = await res.json()
            if (!res.ok) throw new Error(result.error || 'Failed to apply')
            toast.success('Strength session updated')
            applyStatus('applied')
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to apply')
        } finally {
            setIsApplying(false)
        }
    }

    function handleDismiss() {
        applyStatus('dismissed')
    }

    const dateLabel = session
        ? format(parseISO(session.scheduled_date), 'EEE d MMM yyyy')
        : null
    const sessionTitle = session?.title ?? `Session #${proposal.session_id}`

    if (status === 'dismissed') {
        return (
            <Card className="opacity-50 border-dashed">
                <CardContent className="py-3 px-4">
                    <span className="text-sm text-muted-foreground flex items-center gap-2">
                        <X className="h-3 w-3" />
                        Dismissed: {sessionTitle}{dateLabel ? ` on ${dateLabel}` : ''}
                    </span>
                </CardContent>
            </Card>
        )
    }

    if (status === 'applied') {
        return (
            <Card className="border-emerald-200 bg-emerald-50/30 dark:border-emerald-900 dark:bg-emerald-950/30">
                <CardContent className="py-3 px-4">
                    <span className="text-sm flex items-center gap-2 text-emerald-800 dark:text-emerald-200">
                        <Check className="h-3.5 w-3.5" />
                        Applied to {sessionTitle}{dateLabel ? ` (${dateLabel})` : ''}
                    </span>
                </CardContent>
            </Card>
        )
    }

    if (sessionError) {
        return (
            <Card className="border-destructive/40">
                <CardContent className="py-3 px-4 text-sm text-destructive">
                    {sessionError}. The coach's proposal can't be applied.
                </CardContent>
            </Card>
        )
    }

    return (
        <Card>
            <CardContent className="space-y-3 py-3 px-4">
                <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0">
                        <Dumbbell className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-baseline gap-2">
                                <span className="font-medium">{sessionTitle}</span>
                                <Badge variant="secondary" className="text-[10px]">Modify</Badge>
                            </div>
                            {dateLabel && (
                                <div className="text-xs text-muted-foreground">
                                    {dateLabel}{session?.program_name ? ` · from ${session.program_name}` : ''}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Why: </span>{proposal.rationale}
                </div>

                <div className="space-y-2">
                    {draft.map((ex, i) => (
                        <ExerciseEditRow
                            key={i}
                            exercise={ex}
                            canDelete={draft.length > 1}
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

                <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                    <Button variant="ghost" size="sm" onClick={handleDismiss} disabled={isApplying}>
                        Dismiss
                    </Button>
                    <Button size="sm" onClick={handleApply} disabled={isApplying || !session}>
                        {isApplying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Apply
                    </Button>
                </div>
            </CardContent>
        </Card>
    )
}
