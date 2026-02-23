'use client'

import { useState, useMemo } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { CoachInterface } from '@/components/chat/coach-interface'
import { SessionList } from '@/components/chat/session-list'
import { Button } from '@/components/ui/button'
import { PlusCircle, X } from 'lucide-react'

export default function ChatPage() {
    const searchParams = useSearchParams()
    const router = useRouter()
    const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null)

    const workoutId = useMemo(() => {
        const raw = searchParams.get('workoutId')
        if (!raw) return null
        const id = parseInt(raw, 10)
        return isNaN(id) ? null : id
    }, [searchParams])

    const handleNewChat = () => {
        setSelectedSessionId(null)
        router.replace('/dashboard/chat')
    }

    const dismissWorkoutContext = () => {
        router.replace('/dashboard/chat')
    }

    return (
        <div className="space-y-6 h-full flex flex-col">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold tracking-tight">AI Coach</h1>
                <Button onClick={handleNewChat} variant="outline" size="sm" className="gap-2">
                    <PlusCircle className="h-4 w-4" />
                    New Chat
                </Button>
            </div>

            {workoutId && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted text-sm text-muted-foreground border">
                    <span className="flex-1">
                        Discussing workout #{workoutId} — context loaded for AI Coach
                    </span>
                    <button
                        onClick={dismissWorkoutContext}
                        className="hover:text-foreground transition-colors"
                        aria-label="Dismiss workout context"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            )}

            <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-6 h-[calc(100vh-12rem)] min-h-[400px]">
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
