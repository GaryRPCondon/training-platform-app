'use client'

import { Suspense, useState, useMemo, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { CoachInterface } from '@/components/chat/coach-interface'
import { SessionList } from '@/components/chat/session-list'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PlusCircle, X, Calendar, Ruler, Clock } from 'lucide-react'

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
    const searchParams = useSearchParams()
    const router = useRouter()
    const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null)
    const [workoutContext, setWorkoutContext] = useState<WorkoutContext | null>(null)

    const workoutId = useMemo(() => {
        const raw = searchParams.get('workoutId')
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

    const handleNewChat = () => {
        setSelectedSessionId(null)
        setWorkoutContext(null)
        router.replace('/dashboard/chat')
    }

    const dismissWorkoutContext = () => {
        setWorkoutContext(null)
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
                <h1 className="text-3xl font-bold tracking-tight">AI Coach</h1>
                <Button onClick={handleNewChat} variant="outline" size="sm" className="gap-2">
                    <PlusCircle className="h-4 w-4" />
                    New Chat
                </Button>
            </div>

            {workoutContext && (
                <div className="flex items-start gap-3 px-4 py-3 rounded-lg border bg-card shadow-sm">
                    <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                Workout context
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
                        aria-label="Dismiss workout context"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            )}

            <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-6 min-h-0 h-[calc(100vh-12rem)]">
                {/* Sidebar */}
                <div className="hidden md:block border rounded-lg p-2 bg-card">
                    <div className="mb-2 px-2 py-1 text-sm font-semibold text-muted-foreground">
                        Recent Chats
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
                        onSessionChange={setSelectedSessionId}
                        workoutId={workoutId ?? undefined}
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
