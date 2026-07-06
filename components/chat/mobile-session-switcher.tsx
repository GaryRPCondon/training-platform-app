'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'

interface Session {
    id: number
    session_type: string
    started_at: string
    title: string | null
}

interface MobileSessionSwitcherProps {
    currentSessionId: number | null
    onSelectSession: (sessionId: number) => void
}

// Mobile-only counterpart to <SessionList>: the desktop sidebar is hidden below
// the `md` breakpoint, so this dropdown gives mobile users a way to browse and
// switch between recent chat sessions. Shares the ['chat-sessions'] query key so
// React Query dedupes the fetch with the sidebar.
export function MobileSessionSwitcher({ currentSessionId, onSelectSession }: MobileSessionSwitcherProps) {
    const t = useTranslations('chat')
    const { data } = useQuery({
        queryKey: ['chat-sessions'],
        queryFn: async () => {
            const res = await fetch('/api/agent/sessions')
            if (!res.ok) throw new Error('Failed to fetch sessions')
            return res.json()
        },
    })

    const sessions: Session[] = data?.sessions || []
    if (sessions.length === 0) return null

    return (
        <Select
            value={currentSessionId != null ? String(currentSessionId) : undefined}
            onValueChange={(value) => onSelectSession(Number(value))}
        >
            <SelectTrigger className="w-full">
                <SelectValue placeholder={t('selectChatHistory')} />
            </SelectTrigger>
            <SelectContent>
                {sessions.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                        {s.title || s.session_type.replace('_', ' ')}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}
