import { createClient } from '@/lib/supabase/client'
import { ChatSession, ChatMessage } from '@/types/database'
import { ensureAthleteExists } from '@/lib/supabase/ensure-athlete'

export interface CreateSessionParams {
    athleteId: string
    sessionType: 'weekly_planning' | 'workout_modification' | 'feedback' | 'general'
    weeklyPlanId?: number
    workoutId?: number
    context?: any
}

/**
 * Create a new chat session
 */
export async function createChatSession(params: CreateSessionParams): Promise<ChatSession> {
    const supabase = createClient()

    const { data, error } = await supabase
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
export async function getChatSession(sessionId: number): Promise<ChatSession & { messages: ChatMessage[] }> {
    const supabase = createClient()

    const { data: session, error: sessionError } = await supabase
        .from('chat_sessions')
        .select('*')
        .eq('id', sessionId)
        .single()

    if (sessionError) throw sessionError

    const { data: messages, error: messagesError } = await supabase
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
export async function endChatSession(sessionId: number): Promise<void> {
    const supabase = createClient()

    const { error } = await supabase
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
        tokenUsage?: any
        actionTaken?: any
    }
): Promise<ChatMessage> {
    const supabase = createClient()

    const { data, error } = await supabase
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
export async function getRecentSessions(athleteId: string, limit = 10): Promise<ChatSession[]> {
    const supabase = createClient()

    const { data, error } = await supabase
        .from('chat_sessions')
        .select('*')
        .eq('athlete_id', athleteId)
        .order('started_at', { ascending: false })
        .limit(limit)

    if (error) throw error
    return data || []
}
