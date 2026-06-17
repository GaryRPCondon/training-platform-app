'use client'

import { Suspense, useState, useMemo, useEffect, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { CoachInterface } from '@/components/chat/coach-interface'
import { SessionList } from '@/components/chat/session-list'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PlusCircle, X, Calendar, Ruler, Clock, TrendingUp, Dumbbell } from 'lucide-react'

interface ActivityContext {
    id: number
    activity_name: string | null
    activity_type: string | null
    start_time: string
    distance_meters: number | null
    duration_seconds: number | null
    avg_hr: number | null
    max_hr: number | null
    source: string
}

interface WorkoutContext {
    id: number
    scheduled_date: string
    workout_type: string
    description: string | null
    distance_target_meters: number | null
    duration_target_seconds: number | null
    intensity_target: string | null
    completion_status: string
}

interface StrengthSessionContext {
    id: number
    scheduled_date: string
    title: string
    completion_status: 'pending' | 'completed' | 'partial' | 'skipped'
    estimated_duration_minutes: number | null
    exercises: Array<{ display_name: string }>
}

const WORKOUT_TYPE_LABELS: Record<string, string> = {
    easy_run: 'Easy Run',
    long_run: 'Long Run',
    intervals: 'Intervals',
    tempo: 'Tempo',
    rest: 'Rest',
    cross_training: 'Cross Training',
    recovery: 'Recovery',
    race: 'Race',
}

const WORKOUT_TYPE_COLORS: Record<string, string> = {
    easy_run: 'bg-green-100 text-green-800 border-green-200',
    long_run: 'bg-blue-100 text-blue-800 border-blue-200',
    intervals: 'bg-red-100 text-red-800 border-red-200',
    tempo: 'bg-orange-100 text-orange-800 border-orange-200',
    rest: 'bg-gray-100 text-gray-600 border-gray-200',
    cross_training: 'bg-purple-100 text-purple-800 border-purple-200',
    recovery: 'bg-teal-100 text-teal-800 border-teal-200',
    race: 'bg-yellow-100 text-yellow-800 border-yellow-200',
}

function formatDate(dateStr: string) {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString(undefined, {
        weekday: 'short', day: 'numeric', month: 'short'
    })
}

function formatDistance(meters: number) {
    return meters >= 1000
        ? `${(meters / 1000).toFixed(1)} km`
        : `${meters} m`
}

function formatDuration(seconds: number) {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    return h > 0 ? `${h}h ${m}m` : `${m} min`
}

function ChatPageInner() {
    const t = useTranslations('chat')
    const searchParams = useSearchParams()
    const router = useRouter()
    const queryClient = useQueryClient()
    const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null)

    // When a new session is created by the coach, refresh the sidebar list
    const handleSessionChange = useCallback((id: number) => {
        setSelectedSessionId(id)
        queryClient.invalidateQueries({ queryKey: ['chat-sessions'] })
    }, [queryClient])
    const [workoutContext, setWorkoutContext] = useState<WorkoutContext | null>(null)
    const [activityContext, setActivityContext] = useState<ActivityContext | null>(null)
    const [strengthSessionContext, setStrengthSessionContext] = useState<StrengthSessionContext | null>(null)

    const workoutId = useMemo(() => {
        const raw = searchParams.get('workoutId')
        if (!raw) return null
        const id = parseInt(raw, 10)
        return isNaN(id) ? null : id
    }, [searchParams])

    const activityId = useMemo(() => {
        const raw = searchParams.get('activityId')
        if (!raw) return null
        const id = parseInt(raw, 10)
        return isNaN(id) ? null : id
    }, [searchParams])

    const strengthSessionId = useMemo(() => {
        const raw = searchParams.get('strengthSessionId')
        if (!raw) return null
        const id = parseInt(raw, 10)
        return isNaN(id) ? null : id
    }, [searchParams])

    // Fetch workout details when workoutId is set
    useEffect(() => {
        if (!workoutId) return
        let cancelled = false
        fetch(`/api/workouts/${workoutId}`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (!cancelled && data?.workout) setWorkoutContext(data.workout)
            })
            .catch(() => { /* non-critical */ })
        return () => { cancelled = true }
    }, [workoutId])

    // Fetch activity details when activityId is set
    useEffect(() => {
        if (!activityId) return
        let cancelled = false
        fetch(`/api/activities/${activityId}`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (!cancelled && data?.activity) setActivityContext(data.activity)
            })
            .catch(() => { /* non-critical */ })
        return () => { cancelled = true }
    }, [activityId])

    // Fetch strength session details when strengthSessionId is set
    useEffect(() => {
        if (!strengthSessionId) return
        let cancelled = false
        fetch(`/api/strength/sessions/${strengthSessionId}`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (!cancelled && data?.session) setStrengthSessionContext(data.session)
            })
            .catch(() => { /* non-critical */ })
        return () => { cancelled = true }
    }, [strengthSessionId])

    const handleNewChat = () => {
        setSelectedSessionId(null)
        setWorkoutContext(null)
        setActivityContext(null)
        setStrengthSessionContext(null)
        router.replace('/dashboard/chat')
    }

    const dismissWorkoutContext = () => {
        setWorkoutContext(null)
        router.replace('/dashboard/chat')
    }

    const dismissActivityContext = () => {
        setActivityContext(null)
        router.replace('/dashboard/chat')
    }

    const dismissStrengthSessionContext = () => {
        setStrengthSessionContext(null)
        router.replace('/dashboard/chat')
    }

    const typeLabel = workoutContext
        ? (WORKOUT_TYPE_LABELS[workoutContext.workout_type] ?? workoutContext.workout_type.replace(/_/g, ' '))
        : null
    const typeColor = workoutContext
        ? (WORKOUT_TYPE_COLORS[workoutContext.workout_type] ?? 'bg-muted text-muted-foreground border-border')
        : null

    return (
        <div className="space-y-4 h-full flex flex-col">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
                <Button onClick={handleNewChat} variant="outline" size="sm" className="gap-2">
                    <PlusCircle className="h-4 w-4" />
                    {t('newChat')}
                </Button>
            </div>

            {workoutContext && (
                <div className="flex items-start gap-3 px-4 py-3 rounded-lg border bg-card shadow-sm">
                    <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                {t('workoutContext')}
                            </span>
                            <Badge variant="outline" className={`text-xs ${typeColor}`}>
                                {typeLabel}
                            </Badge>
                        </div>
                        {workoutContext.description && (
                            <p className="text-sm font-medium truncate">{workoutContext.description}</p>
                        )}
                        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                            <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {formatDate(workoutContext.scheduled_date)}
                            </span>
                            {workoutContext.distance_target_meters && (
                                <span className="flex items-center gap-1">
                                    <Ruler className="h-3 w-3" />
                                    {formatDistance(workoutContext.distance_target_meters)}
                                </span>
                            )}
                            {workoutContext.duration_target_seconds && (
                                <span className="flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    {formatDuration(workoutContext.duration_target_seconds)}
                                </span>
                            )}
                            {workoutContext.intensity_target && (
                                <span className="capitalize">{workoutContext.intensity_target}</span>
                            )}
                        </div>
                    </div>
                    <button
                        onClick={dismissWorkoutContext}
                        className="text-muted-foreground hover:text-foreground transition-colors mt-0.5 shrink-0"
                        aria-label={t('dismissWorkout')}
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            )}

            {strengthSessionContext && (
                <div className="flex items-start gap-3 px-4 py-3 rounded-lg border bg-card shadow-sm">
                    <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                {t('strengthContext')}
                            </span>
                            <Badge variant="outline" className="text-xs bg-slate-100 text-slate-800 border-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:border-slate-700">
                                <Dumbbell className="h-3 w-3 me-1" />
                                {t('strength')}
                            </Badge>
                        </div>
                        <p className="text-sm font-medium truncate">{strengthSessionContext.title}</p>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                            <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {formatDate(strengthSessionContext.scheduled_date)}
                            </span>
                            {strengthSessionContext.estimated_duration_minutes != null && (
                                <span className="flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    {t('durationMin', { min: strengthSessionContext.estimated_duration_minutes })}
                                </span>
                            )}
                            <span className="capitalize">{strengthSessionContext.completion_status}</span>
                            {strengthSessionContext.exercises.length > 0 && (
                                <span className="truncate">
                                    {t('exerciseCount', { count: strengthSessionContext.exercises.length })}
                                </span>
                            )}
                        </div>
                    </div>
                    <button
                        onClick={dismissStrengthSessionContext}
                        className="text-muted-foreground hover:text-foreground transition-colors mt-0.5 shrink-0"
                        aria-label={t('dismissStrength')}
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            )}

            {activityContext && (
                <div className="flex items-start gap-3 px-4 py-3 rounded-lg border bg-card shadow-sm">
                    <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                {t('activityContext')}
                            </span>
                            <Badge variant="secondary" className="text-xs capitalize">
                                {activityContext.source}
                            </Badge>
                        </div>
                        <p className="text-sm font-medium truncate">
                            {activityContext.activity_name || t('activityFallback')}
                        </p>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                            <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {new Date(activityContext.start_time).toLocaleDateString(undefined, {
                                    weekday: 'short', day: 'numeric', month: 'short'
                                })}
                            </span>
                            {activityContext.distance_meters && (
                                <span className="flex items-center gap-1">
                                    <Ruler className="h-3 w-3" />
                                    {formatDistance(activityContext.distance_meters)}
                                </span>
                            )}
                            {activityContext.duration_seconds && (
                                <span className="flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    {formatDuration(activityContext.duration_seconds)}
                                </span>
                            )}
                            {activityContext.avg_hr && (
                                <span className="flex items-center gap-1">
                                    <TrendingUp className="h-3 w-3" />
                                    {activityContext.avg_hr}{activityContext.max_hr ? `/${activityContext.max_hr}` : ''} bpm
                                </span>
                            )}
                        </div>
                    </div>
                    <button
                        onClick={dismissActivityContext}
                        className="text-muted-foreground hover:text-foreground transition-colors mt-0.5 shrink-0"
                        aria-label={t('dismissActivity')}
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            )}

            <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-6 min-h-0 h-[calc(100vh-12rem)]">
                {/* Sidebar */}
                <div className="hidden md:block border rounded-lg p-2 bg-card">
                    <div className="mb-2 px-2 py-1 text-sm font-semibold text-muted-foreground">
                        {t('recentChats')}
                    </div>
                    <SessionList
                        currentSessionId={selectedSessionId}
                        onSelectSession={setSelectedSessionId}
                    />
                </div>

                {/* Main Chat Area */}
                <div className="md:col-span-3 h-full">
                    <CoachInterface
                        sessionId={selectedSessionId}
                        onSessionChange={handleSessionChange}
                        workoutId={workoutId ?? undefined}
                        activityId={activityId ?? undefined}
                        strengthSessionId={strengthSessionId ?? undefined}
                        workoutContext={workoutContext
                            ? { id: workoutContext.id, scheduled_date: workoutContext.scheduled_date }
                            : null}
                    />
                </div>
            </div>
        </div>
    )
}

export default function ChatPage() {
    return (
        <Suspense>
            <ChatPageInner />
        </Suspense>
    )
}
