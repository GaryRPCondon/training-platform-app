'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CheckCircle, Star, X, Pencil, Plus, Trash2, Loader2 } from 'lucide-react'
import { WorkoutCard } from '@/components/review/workout-card'
import type { WorkoutProposal } from '@/lib/agent/coach-tools'
import type { WorkoutWithDetails } from '@/types/review'
import type { TrainingPaces } from '@/types/database'
import { useQueryClient } from '@tanstack/react-query'

// ---------------------------------------------------------------------------
// Structured workout types (mirrors the JSONB schema from coach-tools.ts)
// ---------------------------------------------------------------------------
interface StructuredInterval {
    distance_meters?: number
    duration_seconds?: number
    intensity: string
    target_pace?: string
}
interface StructuredSet {
    repeat: number
    skip_last_recovery?: boolean
    intervals: StructuredInterval[]
}
interface StructuredWarmupCooldown {
    duration_minutes?: number
    distance_meters?: number
    intensity: string
}
interface StructuredWorkout {
    warmup?: StructuredWarmupCooldown
    main_set?: StructuredSet[]
    cooldown?: StructuredWarmupCooldown
    pace_guidance?: string
    notes?: string
}

function formatInterval(interval: StructuredInterval): string {
    const dist = interval.distance_meters
        ? interval.distance_meters >= 1000
            ? `${(interval.distance_meters / 1000).toFixed(1)}km`
            : `${interval.distance_meters}m`
        : null
    const dur = interval.duration_seconds
        ? interval.duration_seconds >= 60
            ? `${Math.round(interval.duration_seconds / 60)}min`
            : `${interval.duration_seconds}s`
        : null
    const size = dist ?? dur ?? ''
    const pace = interval.target_pace ? ` @ ${interval.target_pace}` : ''
    return `${size} ${interval.intensity}${pace}`.trim()
}

function formatWarmupCooldown(part: StructuredWarmupCooldown): string {
    if (part.distance_meters) {
        const dist = part.distance_meters >= 1000
            ? `${(part.distance_meters / 1000).toFixed(1)}km`
            : `${part.distance_meters}m`
        return `${dist} ${part.intensity}`
    }
    if (part.duration_minutes) return `${part.duration_minutes}min ${part.intensity}`
    return part.intensity
}

function StructuredWorkoutSummary({ structured }: { structured: StructuredWorkout }) {
    const mainSet = structured.main_set ?? []
    const hasContent = structured.warmup || mainSet.length > 0 || structured.cooldown
    if (!hasContent) return null

    return (
        <div className="rounded-md border bg-muted/40 px-3 py-2 space-y-1.5 text-xs">
            {structured.warmup && (
                <div className="flex gap-2">
                    <span className="text-muted-foreground w-16 shrink-0">Warmup</span>
                    <span className="capitalize">{formatWarmupCooldown(structured.warmup)}</span>
                </div>
            )}
            {mainSet.map((set, i) => (
                <div key={i} className="flex gap-2">
                    <span className="text-muted-foreground w-16 shrink-0">
                        {set.repeat > 1 ? `${set.repeat}×` : 'Main'}
                    </span>
                    <span className="space-x-1">
                        {set.intervals.map((iv, j) => (
                            <span key={j}>
                                {j > 0 && <span className="text-muted-foreground mx-0.5">→</span>}
                                <span className="capitalize">{formatInterval(iv)}</span>
                            </span>
                        ))}
                        {set.skip_last_recovery && (
                            <span className="text-muted-foreground italic ml-1">(skip last recovery)</span>
                        )}
                    </span>
                </div>
            ))}
            {structured.cooldown && (
                <div className="flex gap-2">
                    <span className="text-muted-foreground w-16 shrink-0">Cooldown</span>
                    <span className="capitalize">{formatWarmupCooldown(structured.cooldown)}</span>
                </div>
            )}
            {structured.pace_guidance && (
                <div className="flex gap-2 pt-0.5 border-t border-border/50">
                    <span className="text-muted-foreground w-16 shrink-0">Pace</span>
                    <span>{structured.pace_guidance}</span>
                </div>
            )}
            {structured.notes && (
                <div className="flex gap-2">
                    <span className="text-muted-foreground w-16 shrink-0">Notes</span>
                    <span className="italic">{structured.notes}</span>
                </div>
            )}
        </div>
    )
}

// ---------------------------------------------------------------------------
// Shim: build a WorkoutWithDetails from a proposal so WorkoutCard can render it
// ---------------------------------------------------------------------------
function proposalToWorkoutWithDetails(
    proposal: WorkoutProposal,
    athleteId: string
): WorkoutWithDetails {
    const now = new Date().toISOString()
    const date = new Date(proposal.scheduled_date + 'T12:00:00')

    return {
        // PlannedWorkout fields
        id: -1,  // sentinel — isNew mode POSTs rather than PATCHing
        weekly_plan_id: null,
        athlete_id: athleteId,
        scheduled_date: proposal.scheduled_date,
        scheduled_time: null,
        workout_type: proposal.workout_type as WorkoutWithDetails['workout_type'],
        workout_index: null,
        description: proposal.description,
        distance_target_meters: proposal.distance_target_meters ?? null,
        duration_target_seconds: proposal.duration_target_seconds ?? null,
        intensity_target: proposal.intensity_target ?? null,
        structured_workout: proposal.structured_workout ?? null,
        status: 'scheduled',
        completed_activity_id: null,
        completion_status: 'pending',
        completion_metadata: null,
        agent_rationale: proposal.rationale,
        agent_decision_metadata: null,
        notes: null,
        version: 1,
        created_at: now,
        updated_at: now,
        garmin_workout_id: null,
        garmin_scheduled_at: null,
        garmin_sync_status: null,
        activities: undefined,
        // WorkoutWithDetails computed fields
        date,
        formatted_date: format(date, 'EEE d MMM yyyy'),
        phase_name: 'Proposed',
        week_of_plan: 0,
    }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProposalCardProps {
    proposal: WorkoutProposal
    messageId: number
    proposalIndex: number
    athleteId: string
    trainingPaces?: TrainingPaces | null
    vdot?: number | null
    /** Called when the proposal's status changes so parent can update its state */
    onStatusChange?: (proposalIndex: number, status: 'applied' | 'dismissed') => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProposalCard({
    proposal,
    messageId,
    proposalIndex,
    athleteId,
    trainingPaces,
    vdot,
    onStatusChange,
}: ProposalCardProps) {
    const queryClient = useQueryClient()
    const [status, setStatus] = useState(proposal.proposal_status ?? 'pending')
    const [isApplying, setIsApplying] = useState(false)
    const [showRemovePrompt, setShowRemovePrompt] = useState(false)
    const [isRemoving, setIsRemoving] = useState(false)
    const [removed, setRemoved] = useState(false)
    const [showEditDialog, setShowEditDialog] = useState(false)

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    async function persistStatus(newStatus: 'applied' | 'dismissed') {
        try {
            await fetch('/api/agent/coach', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messageId, proposalIndex, status: newStatus }),
            })
        } catch {
            // Non-critical — local state still correct
        }
    }

    function applyStatus(newStatus: 'applied' | 'dismissed') {
        setStatus(newStatus)
        onStatusChange?.(proposalIndex, newStatus)
        persistStatus(newStatus)
    }

    // -----------------------------------------------------------------------
    // Apply to plan
    // -----------------------------------------------------------------------

    async function handleApply() {
        setIsApplying(true)
        try {
            const res = await fetch('/api/workouts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    scheduled_date: proposal.scheduled_date,
                    workout_type: proposal.workout_type,
                    description: proposal.description,
                    distance_target_meters: proposal.distance_target_meters,
                    duration_target_seconds: proposal.duration_target_seconds,
                    intensity_target: proposal.intensity_target,
                    structured_workout: proposal.structured_workout,
                }),
            })

            if (!res.ok) throw new Error('Failed to create workout')

            applyStatus('applied')
            queryClient.invalidateQueries({ queryKey: ['workouts'] })

            if (proposal.supersedes_workout_id) {
                setShowRemovePrompt(true)
            }
        } catch {
            // Leave as pending so the athlete can retry
        } finally {
            setIsApplying(false)
        }
    }

    // -----------------------------------------------------------------------
    // Remove superseded workout
    // -----------------------------------------------------------------------

    async function handleRemoveOld() {
        if (!proposal.supersedes_workout_id) return
        setIsRemoving(true)
        try {
            const res = await fetch(`/api/workouts?id=${proposal.supersedes_workout_id}`, {
                method: 'DELETE',
            })
            if (!res.ok) throw new Error('Failed to delete workout')
            setRemoved(true)
            setShowRemovePrompt(false)
            queryClient.invalidateQueries({ queryKey: ['workouts'] })
        } catch {
            // Leave prompt visible so they can retry
        } finally {
            setIsRemoving(false)
        }
    }

    // -----------------------------------------------------------------------
    // Dismiss
    // -----------------------------------------------------------------------

    function handleDismiss() {
        applyStatus('dismissed')
    }

    // -----------------------------------------------------------------------
    // Formatting helpers
    // -----------------------------------------------------------------------

    const dateLabel = format(new Date(proposal.scheduled_date + 'T12:00:00'), 'EEE d MMM yyyy')

    const distanceLabel = proposal.distance_target_meters
        ? `${(proposal.distance_target_meters / 1000).toFixed(1)} km`
        : proposal.duration_target_seconds
            ? `${Math.round(proposal.duration_target_seconds / 60)} min`
            : null

    const workoutTypeLabel = proposal.workout_type
        .split('_')
        .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')

    // -----------------------------------------------------------------------
    // Dismissed state — show minimal card
    // -----------------------------------------------------------------------

    if (status === 'dismissed') {
        return (
            <Card className="opacity-50 border-dashed">
                <CardContent className="py-3 px-4">
                    <span className="text-sm text-muted-foreground flex items-center gap-2">
                        <X className="h-3 w-3" />
                        Dismissed: {workoutTypeLabel} on {dateLabel}
                    </span>
                </CardContent>
            </Card>
        )
    }

    // -----------------------------------------------------------------------
    // Applied state
    // -----------------------------------------------------------------------

    if (status === 'applied') {
        return (
            <Card className="border-green-200 dark:border-green-900">
                <CardContent className="py-3 px-4 space-y-3">
                    <span className="text-sm text-green-700 dark:text-green-400 flex items-center gap-2">
                        <CheckCircle className="h-4 w-4" />
                        Applied: {workoutTypeLabel} on {dateLabel}
                    </span>

                    {/* Remove old workout prompt */}
                    {showRemovePrompt && !removed && (
                        <div className="rounded-md bg-muted p-3 text-sm space-y-2">
                            <p className="text-muted-foreground">
                                This was suggested as a replacement for the existing workout.
                                Would you like to remove the old one?
                            </p>
                            <div className="flex gap-2">
                                <Button
                                    size="sm"
                                    variant="destructive"
                                    onClick={handleRemoveOld}
                                    disabled={isRemoving}
                                    className="gap-1"
                                >
                                    {isRemoving
                                        ? <Loader2 className="h-3 w-3 animate-spin" />
                                        : <Trash2 className="h-3 w-3" />
                                    }
                                    Remove Old Workout
                                </Button>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setShowRemovePrompt(false)}
                                    disabled={isRemoving}
                                >
                                    Keep Both
                                </Button>
                            </div>
                        </div>
                    )}

                    {removed && (
                        <p className="text-sm text-muted-foreground flex items-center gap-1">
                            <Trash2 className="h-3 w-3" />
                            Old workout removed.
                        </p>
                    )}
                </CardContent>
            </Card>
        )
    }

    // -----------------------------------------------------------------------
    // Pending state — full card
    // -----------------------------------------------------------------------

    return (
        <>
            <Card className="border-primary/30">
                <CardContent className="pt-4 space-y-3">
                    {/* Header row */}
                    <div className="flex items-start justify-between gap-2">
                        <div className="space-y-0.5">
                            <div className="flex items-center gap-2 flex-wrap">
                                {proposal.is_preferred && (
                                    <Badge variant="default" className="gap-1 text-xs">
                                        <Star className="h-3 w-3" />
                                        Recommended
                                    </Badge>
                                )}
                                <span className="font-medium">{workoutTypeLabel}</span>
                            </div>
                            <p className="text-sm text-muted-foreground">{dateLabel}</p>
                        </div>
                        {distanceLabel && (
                            <span className="text-lg font-semibold tabular-nums shrink-0">
                                {distanceLabel}
                            </span>
                        )}
                    </div>

                    {/* Description */}
                    {proposal.description && (
                        <p className="text-sm">{proposal.description}</p>
                    )}

                    {/* Intensity */}
                    {proposal.intensity_target && !proposal.structured_workout && (
                        <p className="text-xs text-muted-foreground capitalize">
                            Intensity: {proposal.intensity_target}
                        </p>
                    )}

                    {/* Structured workout breakdown */}
                    {proposal.structured_workout && (
                        <StructuredWorkoutSummary
                            structured={proposal.structured_workout as StructuredWorkout}
                        />
                    )}

                    {/* Rationale */}
                    <p className="text-sm text-muted-foreground border-l-2 border-muted pl-3 italic">
                        {proposal.rationale}
                    </p>
                </CardContent>

                <CardFooter className="pt-0 gap-2 flex-wrap">
                    <Button
                        size="sm"
                        onClick={handleApply}
                        disabled={isApplying}
                        className="gap-1"
                    >
                        {isApplying
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <Plus className="h-3 w-3" />
                        }
                        Apply to Plan
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setShowEditDialog(true)}
                        className="gap-1"
                    >
                        <Pencil className="h-3 w-3" />
                        Edit First
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleDismiss}
                        className="gap-1 text-muted-foreground"
                    >
                        <X className="h-3 w-3" />
                        Dismiss
                    </Button>
                </CardFooter>
            </Card>

            {/* Edit First dialog — WorkoutCard in isNew mode */}
            <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Edit Proposed Workout</DialogTitle>
                    </DialogHeader>
                    <WorkoutCard
                        workout={proposalToWorkoutWithDetails(proposal, athleteId)}
                        trainingPaces={trainingPaces}
                        vdot={vdot}
                        isNew={true}
                        onCreated={() => {
                            setShowEditDialog(false)
                            applyStatus('applied')
                            queryClient.invalidateQueries({ queryKey: ['workouts'] })
                            if (proposal.supersedes_workout_id) {
                                setShowRemovePrompt(true)
                            }
                        }}
                        onClose={() => setShowEditDialog(false)}
                    />
                </DialogContent>
            </Dialog>
        </>
    )
}
