'use client'

import { useState, useRef, useEffect } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Card } from '@/components/ui/card'
import { Loader2 } from 'lucide-react'

interface Message {
    role: 'user' | 'assistant'
    content: string
}

interface ChatInterfaceProps {
    sessionId?: number | null
    onSessionChange?: (sessionId: number) => void
}

export function ChatInterface({ sessionId: propSessionId, onSessionChange }: ChatInterfaceProps = {}) {
    const [messages, setMessages] = useState<Message[]>([])
    const [input, setInput] = useState('')
    const [internalSessionId, setInternalSessionId] = useState<number | null>(null)
    const scrollRef = useRef<HTMLDivElement>(null)

    const activeSessionId = propSessionId !== undefined ? propSessionId : internalSessionId

    // Load chat history on mount if activeSessionId exists
    useEffect(() => {
        const loadHistory = async () => {
            if (!activeSessionId) {
                setMessages([])
                return
            }

            try {
                const response = await fetch(`/api/agent/chat/history?sessionId=${activeSessionId}`)
                if (response.ok) {
                    const data = await response.json()
                    setMessages(data.messages || [])
                }
            } catch (error) {
                console.error('Failed to load chat history:', error)
            }
        }

        loadHistory()
    }, [activeSessionId])

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollIntoView({ behavior: 'smooth' })
        }
    }, [messages])

    const sendMessage = useMutation({
        mutationFn: async (userMessage: string) => {
            const response = await fetch('/api/agent/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [...messages, { role: 'user', content: userMessage }],
                    sessionId: activeSessionId,
                    sessionType: 'general'
                }),
            })

            if (!response.ok) throw new Error('Failed to send message')
            return response.json()
        },
        onSuccess: (data) => {
            if (data.sessionId && !activeSessionId) {
                setInternalSessionId(data.sessionId)
                onSessionChange?.(data.sessionId)
            }
            setMessages(prev => [...prev,
            { role: 'assistant', content: data.message }
            ])
        },
        onError: (error) => {
            console.error('Chat error:', error)
            setMessages(prev => [...prev,
            { role: 'assistant', content: 'Sorry, I encountered an error. Please try again.' }
            ])
        }
    })

    const handleSend = () => {
        if (!input.trim()) return

        const userMsg = input
        setMessages(prev => [...prev, { role: 'user', content: userMsg }])
        setInput('')
        sendMessage.mutate(userMsg)
    }

    return (
        <Card className="flex flex-col h-[600px]">
            <ScrollArea className="flex-1 p-4">
                <div className="space-y-4">
                    {messages.length === 0 && (
                        <div className="text-center text-muted-foreground py-10">
                            <p>👋 Hi! I'm your AI Coach.</p>
                            <p>Ask me about your training plan, recent activities, or for advice.</p>
                        </div>
                    )}

                    {messages.map((msg, i) => (
                        <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[80%] p-3 rounded-lg ${msg.role === 'user'
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-muted'
                                }`}>
                                <div className="whitespace-pre-wrap">{msg.content}</div>
                            </div>
                        </div>
                    ))}

                    {sendMessage.isPending && (
                        <div className="flex justify-start">
                            <div className="bg-muted p-3 rounded-lg flex items-center gap-2">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                <span className="text-sm text-muted-foreground">Thinking...</span>
                            </div>
                        </div>
                    )}
                    <div ref={scrollRef} />
                </div>
            </ScrollArea>

            <div className="p-4 border-t flex gap-2">
                <Textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Ask about your training..."
                    className="min-h-[60px]"
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            handleSend()
                        }
                    }}
                />
                <Button onClick={handleSend} disabled={!input.trim() || sendMessage.isPending}>
                    Send
                </Button>
            </div>
        </Card>
    )
}
