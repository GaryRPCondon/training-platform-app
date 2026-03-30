'use client'

import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { MessageSquare, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface Session {
    id: number
    session_type: string
    started_at: string
    title: string | null
}

interface SessionListProps {
    currentSessionId: number | null
    onSelectSession: (sessionId: number) => void
}

export function SessionList({ currentSessionId, onSelectSession }: SessionListProps) {
    const { data, isLoading } = useQuery({
        queryKey: ['chat-sessions'],
        queryFn: async () => {
            const res = await fetch('/api/agent/sessions')
            if (!res.ok) throw new Error('Failed to fetch sessions')
            return res.json()
        }
    })

    if (isLoading) {
        return <div className="p-4 text-sm text-muted-foreground">Loading history...</div>
    }

    const sessions = data?.sessions || []

    if (sessions.length === 0) {
        return <div className="p-4 text-sm text-muted-foreground">No recent conversations</div>
    }

    return (
        <ScrollArea className="h-[calc(100vh-200px)]">
            <div className="space-y-2 p-2">
                {sessions.map((session: Session) => {
                    const fullTitle = session.title || session.session_type.replace('_', ' ')
                    const truncatedTitle = fullTitle.length > 22
                        ? fullTitle.slice(0, 22) + '…'
                        : fullTitle
                    return (
                        <Tooltip key={session.id}>
                            <TooltipTrigger asChild>
                                <Button
                                    variant={currentSessionId === session.id ? "secondary" : "ghost"}
                                    className={cn(
                                        "w-full justify-start text-left h-auto py-3 px-4",
                                        currentSessionId === session.id && "bg-muted"
                                    )}
                                    onClick={() => onSelectSession(session.id)}
                                >
                                    <div className="flex flex-col gap-1 w-full min-w-0">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                                            <span className="font-medium">
                                                {truncatedTitle}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                            <Clock className="h-3 w-3" />
                                            <span>
                                                {formatDistanceToNow(new Date(session.started_at), { addSuffix: true })}
                                            </span>
                                        </div>
                                    </div>
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="max-w-xs">
                                {fullTitle}
                            </TooltipContent>
                        </Tooltip>
                    )
                })}
            </div>
        </ScrollArea>
    )
}
