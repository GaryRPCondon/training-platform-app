'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Loader2, Send } from 'lucide-react'
import type { ReviewMessage } from '@/types/review'

interface ChatPanelProps {
  planId: number
  sessionId: number
  messages: ReviewMessage[]
  onSendMessage: (message: string) => Promise<void>
  isLoading?: boolean
}

export function ChatPanel({
  planId,
  sessionId,
  messages,
  onSendMessage,
  isLoading = false
}: ChatPanelProps) {
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const scrollAreaRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight
    }
  }, [messages])

  const handleSend = async () => {
    if (!input.trim() || isSending) return

    setIsSending(true)
    try {
      await onSendMessage(input.trim())
      setInput('')
    } finally {
      setIsSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col h-full bg-background border-l">
      {/* Header */}
      <div className="p-4 border-b">
        <h2 className="font-semibold">Chat with Your Coach</h2>
        <p className="text-sm text-muted-foreground">
          Ask questions or request changes using workout codes (e.g., "Make W4:D2 easier")
        </p>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4" ref={scrollAreaRef}>
        <div className="space-y-4">
          {messages.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              <p>Start a conversation about your training plan.</p>
              <p className="text-sm mt-2">
                Try: "What's the purpose of W1:D3?" or "Make W5:D2 10km instead"
              </p>
            </div>
          ) : (
            messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))
          )}

          {isLoading && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Coach is thinking...</span>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="p-4 border-t">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your message... (Shift+Enter for new line)"
            className="min-h-[60px] max-h-[120px]"
            disabled={isSending}
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || isSending}
            size="icon"
            className="shrink-0"
          >
            {isSending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: ReviewMessage }) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'

  if (isSystem) {
    return (
      <div className="text-center text-sm text-muted-foreground py-2">
        {message.content}
      </div>
    )
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-2 ${
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted'
        }`}
      >
        <div className="text-sm whitespace-pre-wrap">{message.content}</div>
        {message.metadata?.referenced_workouts && (
          <div className="flex gap-1 mt-2 flex-wrap">
            {message.metadata.referenced_workouts.map(ref => (
              <span
                key={ref}
                className="text-xs px-2 py-0.5 rounded bg-background/20"
              >
                {ref}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
