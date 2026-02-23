'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Card } from '@/components/ui/card'
import { Loader2 } from 'lucide-react'
import { ProposalCard } from '@/components/chat/proposal-card'
import type { WorkoutProposal } from '@/lib/agent/coach-tools'
import type { TrainingPaces } from '@/types/database'

type LoadingStatus = 'loading' | 'thinking' | null

const CONVERSATION_STARTERS = [
    'How is my training tracking against the plan so far?',
    'Have I done enough quality work this phase?',
    'What should I focus on in the next two weeks?',
    'Can you suggest a workout for tomorrow?',
]

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CoachMessage {
    role: 'user' | 'assistant'
    content: string
    proposals?: WorkoutProposal[]
    /** DB message ID — needed to persist proposal status updates */
    messageId?: number
}

interface AthleteSettings {
    id: string
    vdot: number | null
    training_paces: TrainingPaces | null
}

interface CoachInterfaceProps {
    sessionId?: number | null
    onSessionChange?: (sessionId: number) => void
    workoutId?: number
}

// ---------------------------------------------------------------------------
// Markdown renderer for assistant messages
// ---------------------------------------------------------------------------

function AssistantMessage({ content }: { content: string }) {
    return (
        <div className="prose prose-sm dark:prose-invert max-w-none
            prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1
            prose-li:my-0 prose-table:text-sm prose-pre:text-xs">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {content}
            </ReactMarkdown>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CoachInterface({ sessionId: propSessionId, onSessionChange, workoutId }: CoachInterfaceProps = {}) {
    const [messages, setMessages] = useState<CoachMessage[]>([])
    const [input, setInput] = useState('')
    const [internalSessionId, setInternalSessionId] = useState<number | null>(null)
    const [athleteSettings, setAthleteSettings] = useState<AthleteSettings | null>(null)
    const [loadingStatus, setLoadingStatus] = useState<LoadingStatus>(null)
    const [isSending, setIsSending] = useState(false)
    const scrollRef = useRef<HTMLDivElement>(null)

    const activeSessionId = propSessionId !== undefined ? propSessionId : internalSessionId

    // -----------------------------------------------------------------------
    // Load athlete settings (id, vdot, training paces for Edit First flow)
    // -----------------------------------------------------------------------
    useEffect(() => {
        async function loadAthleteSettings() {
            try {
                const res = await fetch('/api/settings/get')
                if (!res.ok) return
                const data = await res.json()
                setAthleteSettings({
                    id: data.athleteId,
                    vdot: data.vdot ?? null,
                    training_paces: data.training_paces ?? null,
                })
            } catch {
                // Non-critical — Edit First will just not have pace info
            }
        }
        loadAthleteSettings()
    }, [])

    // -----------------------------------------------------------------------
    // Load history when session changes
    // -----------------------------------------------------------------------
    useEffect(() => {
        async function loadHistory() {
            if (!activeSessionId) {
                setMessages([])
                return
            }
            try {
                const res = await fetch(`/api/agent/chat/history?sessionId=${activeSessionId}`)
                if (!res.ok) return
                const data = await res.json()
                const loaded: CoachMessage[] = (data.messages ?? [])
                    .filter((m: any) => m.role !== 'system')
                    .map((m: any) => ({
                        role: m.role as 'user' | 'assistant',
                        content: m.content,
                        messageId: m.id,
                        proposals: m.action_taken?.proposals ?? undefined,
                    }))
                setMessages(loaded)
            } catch {
                // History load failure is non-fatal
            }
        }
        loadHistory()
    }, [activeSessionId])

    // -----------------------------------------------------------------------
    // Auto-scroll
    // -----------------------------------------------------------------------
    useEffect(() => {
        scrollRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages])

    // -----------------------------------------------------------------------
    // Handle proposal status changes (apply/dismiss updates local state)
    // -----------------------------------------------------------------------
    const handleProposalStatusChange = useCallback(
        (messageIndex: number, proposalIndex: number, newStatus: 'applied' | 'dismissed') => {
            setMessages(prev => prev.map((msg, i) => {
                if (i !== messageIndex || !msg.proposals) return msg
                const updated = [...msg.proposals]
                updated[proposalIndex] = { ...updated[proposalIndex], proposal_status: newStatus }
                return { ...msg, proposals: updated }
            }))
        },
        []
    )

    // -----------------------------------------------------------------------
    // Send message — streams response from /api/agent/coach
    // -----------------------------------------------------------------------
    const handleSend = useCallback(async () => {
        const text = input.trim()
        if (!text || isSending) return

        const outgoing = [...messages.map(m => ({ role: m.role, content: m.content })),
                          { role: 'user' as const, content: text }]

        setMessages(prev => [...prev, { role: 'user', content: text }])
        setInput('')
        setIsSending(true)
        setLoadingStatus('loading')

        try {
            const res = await fetch('/api/agent/coach', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: outgoing, sessionId: activeSessionId, workoutId }),
            })

            if (!res.ok || !res.body) throw new Error('Stream unavailable')

            const reader = res.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''
            let streamingMsgAdded = false

            while (true) {
                const { done, value } = await reader.read()
                if (done) break

                buffer += decoder.decode(value, { stream: true })
                const lines = buffer.split('\n')
                buffer = lines.pop() ?? ''

                for (const line of lines) {
                    if (!line.trim()) continue
                    try {
                        const event = JSON.parse(line)

                        if (event.type === 'status') {
                            setLoadingStatus(event.status as LoadingStatus)
                            // Store session ID locally but do NOT notify parent yet —
                            // calling onSessionChange here would trigger the history
                            // useEffect mid-stream, wiping the in-progress assistant message.
                            if (event.sessionId && !activeSessionId) {
                                setInternalSessionId(event.sessionId)
                            }
                        } else if (event.type === 'text') {
                            if (!streamingMsgAdded) {
                                setMessages(prev => [...prev, { role: 'assistant', content: event.chunk }])
                                streamingMsgAdded = true
                            } else {
                                setMessages(prev => {
                                    const last = prev[prev.length - 1]
                                    return [...prev.slice(0, -1),
                                            { ...last, content: last.content + event.chunk }]
                                })
                            }
                        } else if (event.type === 'done') {
                            setMessages(prev => {
                                const last = prev[prev.length - 1]
                                return [...prev.slice(0, -1), {
                                    ...last,
                                    messageId: event.messageId,
                                    proposals: event.proposals?.length > 0 ? event.proposals : undefined,
                                }]
                            })
                            // Now safe to notify parent — assistant message is saved to DB,
                            // so if history reloads it will have the full conversation.
                            if (event.sessionId && !activeSessionId) {
                                onSessionChange?.(event.sessionId)
                            }
                            setLoadingStatus(null)
                        } else if (event.type === 'error') {
                            throw new Error(event.error)
                        }
                    } catch (parseErr) {
                        // Skip malformed lines
                    }
                }
            }
        } catch {
            setMessages(prev => [
                ...prev,
                { role: 'assistant', content: 'Something went wrong. Please try again.' },
            ])
        } finally {
            setIsSending(false)
            setLoadingStatus(null)
        }
    }, [input, isSending, messages, activeSessionId, onSessionChange, workoutId])

    // -----------------------------------------------------------------------
    // Render
    // -----------------------------------------------------------------------
    return (
        <Card className="flex flex-col h-full">
            <ScrollArea className="flex-1 p-4">
                <div className="space-y-4">
                    {messages.length === 0 && (
                        <div className="py-8 space-y-6">
                            <div className="text-center space-y-1">
                                <p className="font-medium">AI Coach</p>
                                <p className="text-sm text-muted-foreground">
                                    Ask about your training, recent performance, or get a workout suggestion.
                                </p>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {CONVERSATION_STARTERS.map((starter) => (
                                    <button
                                        key={starter}
                                        onClick={() => {
                                            setInput(starter)
                                        }}
                                        className="text-left text-sm p-3 rounded-lg border border-border
                                                   hover:bg-muted transition-colors text-muted-foreground
                                                   hover:text-foreground"
                                    >
                                        {starter}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {messages.map((msg, msgIdx) => (
                        <div key={msgIdx} className="space-y-2">
                            {/* Message bubble */}
                            <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[85%] p-3 rounded-lg ${
                                    msg.role === 'user'
                                        ? 'bg-primary text-primary-foreground'
                                        : 'bg-muted'
                                }`}>
                                    {msg.role === 'assistant'
                                        ? <AssistantMessage content={msg.content} />
                                        : <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
                                    }
                                </div>
                            </div>

                            {/* Proposal cards — rendered after the assistant bubble */}
                            {msg.role === 'assistant' && msg.proposals && msg.proposals.length > 0 && (
                                <div className="ml-2 space-y-2 max-w-[85%] min-w-0">
                                    {msg.proposals.map((proposal, propIdx) => (
                                        <ProposalCard
                                            key={propIdx}
                                            proposal={proposal}
                                            messageId={msg.messageId ?? -1}
                                            proposalIndex={propIdx}
                                            athleteId={athleteSettings?.id ?? ''}
                                            trainingPaces={athleteSettings?.training_paces}
                                            vdot={athleteSettings?.vdot}
                                            onStatusChange={(pi, status) =>
                                                handleProposalStatusChange(msgIdx, pi, status)
                                            }
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}

                    {isSending && (
                        <div className="flex justify-start">
                            <div className="bg-muted p-3 rounded-lg flex items-center gap-2">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                <span className="text-sm text-muted-foreground">
                                    {loadingStatus === 'loading'
                                        ? 'Analysing your training data...'
                                        : 'Thinking...'}
                                </span>
                            </div>
                        </div>
                    )}

                    <div ref={scrollRef} />
                </div>
            </ScrollArea>

            <div className="p-4 border-t flex gap-2">
                <Textarea
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    placeholder="Ask about your training..."
                    className="min-h-[60px]"
                    onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            void handleSend()
                        }
                    }}
                />
                <Button
                    onClick={() => void handleSend()}
                    disabled={!input.trim() || isSending}
                >
                    Send
                </Button>
            </div>
        </Card>
    )
}
