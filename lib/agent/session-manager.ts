import { createClient as createBrowserClient } from '@/lib/supabase/client'
import { SupabaseClient } from '@supabase/supabase-js'
import { ChatSession, ChatMessage } from '@/types/database'

export interface CreateSessionParams {
    athleteId: string
    sessionType: 'weekly_planning' | 'workout_modification' | 'feedback' | 'general' | 'coach'
    weeklyPlanId?: number
    workoutId?: number
    context?: Record<string, unknown>
}

function getClient(supabase?: SupabaseClient): SupabaseClient {
    return supabase ?? createBrowserClient()
}

/**
 * Create a new chat session
 */
export async function createChatSession(params: CreateSessionParams, supabase?: SupabaseClient): Promise<ChatSession> {
    const db = getClient(supabase)

    const { data, error } = await db
        .from('chat_sessions')
        .insert({
            athlete_id: params.athleteId,
            session_type: params.sessionType,
            weekly_plan_id: params.weeklyPlanId || null,
            specific_workout_id: params.workoutId || null,
            context: params.context || null,
            started_at: new Date().toISOString()
        })
        .select()
        .single()

    if (error) throw error
    return data
}

/**
 * Get a chat session with its messages
 */
export async function getChatSession(sessionId: number, supabase?: SupabaseClient): Promise<ChatSession & { messages: ChatMessage[] }> {
    const db = getClient(supabase)

    const { data: session, error: sessionError } = await db
        .from('chat_sessions')
        .select('*')
        .eq('id', sessionId)
        .single()

    if (sessionError) throw sessionError

    const { data: messages, error: messagesError } = await db
        .from('chat_messages')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true })

    if (messagesError) throw messagesError

    return { ...session, messages: messages || [] }
}

/**
 * End a chat session
 */
export async function endChatSession(sessionId: number, supabase?: SupabaseClient): Promise<void> {
    const db = getClient(supabase)

    const { error } = await db
        .from('chat_sessions')
        .update({ ended_at: new Date().toISOString() })
        .eq('id', sessionId)

    if (error) throw error
}

/**
 * Save a message to a session
 */
export async function saveMessage(
    sessionId: number,
    role: 'user' | 'assistant' | 'system',
    content: string,
    metadata?: {
        provider?: string
        model?: string
        tokenUsage?: Record<string, unknown>
        actionTaken?: Record<string, unknown>
    },
    supabase?: SupabaseClient
): Promise<ChatMessage> {
    const db = getClient(supabase)

    const { data, error } = await db
        .from('chat_messages')
        .insert({
            session_id: sessionId,
            role,
            content,
            provider: metadata?.provider || null,
            model: metadata?.model || null,
            token_usage: metadata?.tokenUsage || null,
            action_taken: metadata?.actionTaken || null,
            created_at: new Date().toISOString()
        })
        .select()
        .single()

    if (error) throw error
    return data
}

/**
 * Get recent sessions for an athlete
 */
export async function getRecentSessions(athleteId: string, supabase?: SupabaseClient, limit = 10): Promise<ChatSession[]> {
    const db = getClient(supabase)

    const { data, error } = await db
        .from('chat_sessions')
        .select('*')
        .eq('athlete_id', athleteId)
        .order('started_at', { ascending: false })
        .limit(limit)

    if (error) throw error
    return data || []
}
