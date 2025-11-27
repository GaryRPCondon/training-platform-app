'use client'

import { useState } from 'react'
import { ChatInterface } from '@/components/chat/chat-interface'
import { SessionList } from '@/components/chat/session-list'
import { Button } from '@/components/ui/button'
import { PlusCircle } from 'lucide-react'

export default function ChatPage() {
    const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null)

    const handleNewChat = () => {
        setSelectedSessionId(null)
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

            <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-6 h-[600px]">
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
                    <ChatInterface
                        sessionId={selectedSessionId}
                        onSessionChange={setSelectedSessionId}
                    />
                </div>
            </div>
        </div>
    )
}
