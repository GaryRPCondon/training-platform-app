import { NextResponse } from 'next/server'
import { createLLMProvider } from '@/lib/agent/factory'
import { loadAgentContext } from '@/lib/agent/context-loader'
import { getSystemPrompt } from '@/lib/agent/prompts'
import { createChatSession, getChatSession, saveMessage } from '@/lib/agent/session-manager'
import { createClient } from '@/lib/supabase/server'
import { ensureAthleteExists } from '@/lib/supabase/ensure-athlete'

export async function POST(request: Request) {
    try {
        const { messages, sessionId, sessionType = 'general' } = await request.json()

        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Ensure athlete record exists
        const { athleteId, error: athleteError } = await ensureAthleteExists(supabase, user.id, user.email)

        if (athleteError) {
            console.error('Agent API Error:', athleteError)
            return NextResponse.json({ error: athleteError }, { status: 500 })
        }

        // Get or create session
        let currentSessionId = sessionId
        let sessionHistory: any[] = []

        if (sessionId) {
            try {
                const session = await getChatSession(sessionId)
                sessionHistory = session.messages.map(m => ({
                    role: m.role,
                    content: m.content
                }))
            } catch (error) {
                console.error('Error loading session:', error)
            }
        } else {
            // Create new session
            const newSession = await createChatSession({
                athleteId,
                sessionType
            })
            currentSessionId = newSession.id
        }

        // Save user message
        const userMessage = messages[messages.length - 1]
        await saveMessage(currentSessionId, 'user', userMessage.content)

        // Load multi-timescale context
        const context = await loadAgentContext(athleteId)

        // Get athlete's preferred provider
        const { data: athlete } = await supabase
            .from('athletes')
            .select('preferred_llm_provider, preferred_llm_model')
            .eq('id', athleteId)
            .single()

        const providerName = athlete?.preferred_llm_provider || 'deepseek'
        const modelName = athlete?.preferred_llm_model || undefined
        const provider = createLLMProvider(providerName, modelName)

        // Generate system prompt with context
        const systemPrompt = getSystemPrompt(sessionType, context)

        // Combine session history with new messages
        const allMessages = [...sessionHistory, ...messages]

        // Generate response
        const response = await provider.generateResponse({
            messages: allMessages,
            systemPrompt,
            maxTokens: 2000,
            temperature: 0.7,
        })

        // Save assistant message
        await saveMessage(currentSessionId, 'assistant', response.content, {
            provider: providerName,
            model: response.model,
            tokenUsage: response.usage
        })

        return NextResponse.json({
            message: response.content,
            usage: response.usage,
            model: response.model,
            provider: providerName,
            sessionId: currentSessionId
        })
    } catch (error) {
        console.error('Agent API Error:', error)
        return NextResponse.json({ error: 'Agent failed' }, { status: 500 })
    }
}
