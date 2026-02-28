/**
 * AI Coach API Route
 *
 * POST /api/agent/coach
 *
 * Accepts conversation history and returns a coach response plus
 * any structured workout proposals from tool calls.
 *
 * Body: {
 *   messages: { role: 'user' | 'assistant', content: string }[]
 *   sessionId?: number       — omit to create a new coach session
 *   workoutId?: number       — when deep-linked from a calendar workout card
 * }
 *
 * Response: CoachAPIResponse
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ensureAthleteExists } from '@/lib/supabase/ensure-athlete'
import { createLLMProvider } from '@/lib/agent/factory'
import { loadCoachContext } from '@/lib/agent/coach-context-loader'
import { buildCoachSystemPrompt } from '@/lib/agent/coach-prompt'
import { COACH_TOOLS, WorkoutProposal } from '@/lib/agent/coach-tools'
import { createChatSession, getChatSession, saveMessage } from '@/lib/agent/session-manager'
import { calculateMaxTokens, estimateTokens } from '@/lib/chat/token-budget'
import { writeLLMLog } from '@/lib/llm-logger'

// ---------------------------------------------------------------------------
// Format a structured_workout JSONB into readable text for the system prompt.
// This ensures the LLM understands the exact segment breakdown rather than
// guessing from the top-level distance_target_meters alone.
// ---------------------------------------------------------------------------
function formatStructuredWorkoutForPrompt(sw: Record<string, unknown>): string {
    const lines: string[] = ['Structured breakdown:']

    const warmup = sw.warmup as Record<string, unknown> | undefined
    const mainSet = sw.main_set as Record<string, unknown>[] | undefined
    const cooldown = sw.cooldown as Record<string, unknown> | undefined

    if (warmup) {
        const dur = warmup.duration_minutes ? `${warmup.duration_minutes}min` : null
        const dist = warmup.distance_meters
            ? `${((warmup.distance_meters as number) / 1000).toFixed(1)}km`
            : null
        lines.push(`  Warmup: ${dist ?? dur ?? '?'} ${warmup.intensity ?? ''}`.trimEnd())
    }

    if (mainSet) {
        for (const set of mainSet) {
            const repeat = (set.repeat as number) ?? 1
            const intervals = (set.intervals as Record<string, unknown>[]) ?? []
            const parts = intervals.map(iv => {
                const dist = iv.distance_meters
                    ? `${((iv.distance_meters as number) / 1000).toFixed(1)}km`
                    : null
                const dur = iv.duration_seconds
                    ? `${Math.round((iv.duration_seconds as number) / 60)}min`
                    : null
                return `${dist ?? dur ?? '?'} ${iv.intensity ?? ''}`.trim()
            })
            const suffix = set.skip_last_recovery ? ' (skip last recovery)' : ''
            lines.push(`  Main set: ${repeat}× [${parts.join(' → ')}]${suffix}`)
        }
    }

    if (cooldown) {
        const dur = cooldown.duration_minutes ? `${cooldown.duration_minutes}min` : null
        const dist = cooldown.distance_meters
            ? `${((cooldown.distance_meters as number) / 1000).toFixed(1)}km`
            : null
        lines.push(`  Cooldown: ${dist ?? dur ?? '?'} ${cooldown.intensity ?? ''}`.trimEnd())
    }

    const pace = sw.pace_guidance as string | undefined
    if (pace) lines.push(`  Pace guidance: ${pace}`)

    const notes = sw.notes as string | undefined
    if (notes) lines.push(`  Notes: ${notes}`)

    return lines.join('\n')
}

export interface CoachAPIResponse {
    message: string
    proposals: WorkoutProposal[]
    sessionId: number
    messageId: number
    usage: { inputTokens: number; outputTokens: number }
    model: string
    provider: string
}

/**
 * PATCH /api/agent/coach
 *
 * Updates a proposal's status after the athlete acts on it.
 *
 * Body: { messageId: number, proposalIndex: number, status: 'applied' | 'dismissed' }
 */
export async function PATCH(request: Request) {
    try {
        const { messageId, proposalIndex, status } = await request.json()

        if (!messageId || proposalIndex === undefined || !status) {
            return NextResponse.json({ error: 'messageId, proposalIndex and status are required' }, { status: 400 })
        }

        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        // Fetch current action_taken — verify the message belongs to the user via session ownership
        const { data: message, error: fetchError } = await supabase
            .from('chat_messages')
            .select('action_taken, session_id')
            .eq('id', messageId)
            .single()

        if (fetchError || !message) {
            return NextResponse.json({ error: 'Message not found' }, { status: 404 })
        }

        // Auth: verify session belongs to user
        const { data: session } = await supabase
            .from('chat_sessions')
            .select('athlete_id')
            .eq('id', message.session_id)
            .single()

        if (session?.athlete_id !== user.id) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
        }

        // Update the proposal status in the JSONB array
        const actionTaken = message.action_taken ?? { proposals: [] }
        const proposals = actionTaken.proposals ?? []
        if (proposals[proposalIndex]) {
            proposals[proposalIndex].proposal_status = status
        }

        const { error: updateError } = await supabase
            .from('chat_messages')
            .update({ action_taken: { ...actionTaken, proposals } })
            .eq('id', messageId)

        if (updateError) throw updateError

        return NextResponse.json({ ok: true })
    } catch (error) {
        console.error('Coach PATCH error:', error)
        return NextResponse.json({ error: 'Failed to update proposal' }, { status: 500 })
    }
}

export async function POST(request: Request) {
    const { messages, sessionId, workoutId, activityId } = await request.json()

    // -----------------------------------------------------------------------
    // Auth + athlete (must complete before streaming starts)
    // -----------------------------------------------------------------------
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { athleteId, error: athleteError } = await ensureAthleteExists(supabase, user.id, user.email)
    if (athleteError) {
        return NextResponse.json({ error: athleteError }, { status: 500 })
    }

    // -----------------------------------------------------------------------
    // Return a streaming response
    // -----------------------------------------------------------------------
    const encoder = new TextEncoder()

    const stream = new ReadableStream({
        async start(controller) {
            const send = (event: object) => {
                controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'))
            }

            try {
                // ---------------------------------------------------------------
                // Session management
                // ---------------------------------------------------------------
                let currentSessionId: number
                let sessionHistory: { role: 'user' | 'assistant'; content: string }[] = []

                if (sessionId) {
                    try {
                        const session = await getChatSession(sessionId, supabase)
                        sessionHistory = session.messages
                            .filter(m => m.role !== 'system')
                            .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))
                        currentSessionId = sessionId
                    } catch {
                        const newSession = await createChatSession({ athleteId, sessionType: 'coach' }, supabase)
                        currentSessionId = newSession.id
                    }
                } else {
                    const newSession = await createChatSession({ athleteId, sessionType: 'coach' }, supabase)
                    currentSessionId = newSession.id
                }

                // Save incoming user message
                const userMessage = messages[messages.length - 1]
                await saveMessage(currentSessionId, 'user', userMessage.content, undefined, supabase)

                // ---------------------------------------------------------------
                // Loading context — signal the client
                // ---------------------------------------------------------------
                send({ type: 'status', status: 'loading', sessionId: currentSessionId })

                const [athleteSettings, coachContext] = await Promise.all([
                    supabase
                        .from('athletes')
                        .select('preferred_llm_provider, preferred_llm_model')
                        .eq('id', athleteId)
                        .single()
                        .then(r => r.data),
                    loadCoachContext(supabase, athleteId),
                ])

                const providerName = athleteSettings?.preferred_llm_provider ?? 'deepseek'
                const modelName = athleteSettings?.preferred_llm_model ?? undefined
                const provider = createLLMProvider(providerName, modelName)

                // Build system prompt
                let systemPrompt = buildCoachSystemPrompt(coachContext)

                if (workoutId) {
                    // Direct DB lookup — covers any workout regardless of date,
                    // and verifies ownership via athlete_id.
                    const { data: focusWorkout } = await supabase
                        .from('planned_workouts')
                        .select('scheduled_date, workout_type, description, distance_target_meters, duration_target_seconds, intensity_target, completion_status, structured_workout')
                        .eq('id', workoutId)
                        .eq('athlete_id', athleteId)
                        .single()

                    if (focusWorkout) {
                        systemPrompt += `\n\n## Workout in Focus\nThe athlete navigated here from this specific workout. Address it directly in your first response.\n`
                        systemPrompt += `Date: ${focusWorkout.scheduled_date}\n`
                        systemPrompt += `Type: ${focusWorkout.workout_type}\n`
                        if (focusWorkout.description) systemPrompt += `Description: ${focusWorkout.description}\n`
                        if (focusWorkout.intensity_target) systemPrompt += `Intensity: ${focusWorkout.intensity_target}\n`
                        systemPrompt += `Status: ${focusWorkout.completion_status}\n`

                        const sw = focusWorkout.structured_workout as Record<string, unknown> | null
                        if (sw?.main_set) {
                            // Structured workout: show the full breakdown so the LLM understands
                            // exactly what each segment is. distance_target_meters is the MAIN SET
                            // distance only — warmup and cooldown are additional.
                            systemPrompt += formatStructuredWorkoutForPrompt(sw) + '\n'
                            if (focusWorkout.distance_target_meters) {
                                systemPrompt += `Planned distance: ${(focusWorkout.distance_target_meters / 1000).toFixed(1)}km (main workout only — warmup and cooldown are ADDITIONAL to this, not subtracted from it)\n`
                            }
                        } else {
                            // Simple workout: distance/duration is the full workout
                            if (focusWorkout.distance_target_meters) {
                                systemPrompt += `Distance: ${(focusWorkout.distance_target_meters / 1000).toFixed(1)}km\n`
                            }
                            if (focusWorkout.duration_target_seconds) {
                                systemPrompt += `Duration: ${Math.round(focusWorkout.duration_target_seconds / 60)}min\n`
                            }
                        }
                    }
                }

                if (activityId) {
                    const { data: focusActivity } = await supabase
                        .from('activities')
                        .select(`
                            id, activity_name, activity_type, start_time,
                            distance_meters, duration_seconds, avg_hr, max_hr, source,
                            laps (
                                lap_index, distance_meters, avg_pace, avg_hr,
                                intensity_type, compliance_score
                            )
                        `)
                        .eq('id', activityId)
                        .eq('athlete_id', athleteId)
                        .single()

                    if (focusActivity) {
                        const fmtPace = (secPerKm: number | null) => {
                            if (!secPerKm) return null
                            const m = Math.floor(secPerKm / 60)
                            const s = Math.round(secPerKm % 60)
                            return `${m}:${s.toString().padStart(2, '0')}/km`
                        }
                        const fmtDist = (m: number | null) => m ? `${(m / 1000).toFixed(1)}km` : null
                        const fmtDur = (s: number | null) => {
                            if (!s) return null
                            const h = Math.floor(s / 3600)
                            const min = Math.floor((s % 3600) / 60)
                            return h > 0 ? `${h}h ${min}m` : `${min}min`
                        }

                        const date = new Date(focusActivity.start_time).toLocaleDateString('en-GB', {
                            weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
                        })
                        const avgPace = (focusActivity.distance_meters && focusActivity.duration_seconds)
                            ? focusActivity.duration_seconds / (focusActivity.distance_meters / 1000)
                            : null

                        systemPrompt += `\n\n## Activity in Focus\nThe athlete navigated here from this specific activity. Address it directly in your first response.\n`
                        systemPrompt += `Date: ${date}\n`
                        if (focusActivity.activity_name) systemPrompt += `Name: ${focusActivity.activity_name}\n`
                        if (focusActivity.source) systemPrompt += `Source: ${focusActivity.source}\n`
                        if (focusActivity.distance_meters) systemPrompt += `Distance: ${fmtDist(focusActivity.distance_meters)}\n`
                        if (focusActivity.duration_seconds) systemPrompt += `Duration: ${fmtDur(focusActivity.duration_seconds)}\n`
                        if (avgPace) systemPrompt += `Average Pace: ${fmtPace(avgPace)}\n`
                        if (focusActivity.avg_hr) systemPrompt += `Average HR: ${focusActivity.avg_hr} bpm${focusActivity.max_hr ? ` (max ${focusActivity.max_hr})` : ''}\n`

                        const laps = ((focusActivity.laps ?? []) as any[])
                            .filter(l => l.distance_meters !== null || l.avg_pace !== null)
                        if (laps.length > 0) {
                            systemPrompt += `Laps (${laps.length}):\n`
                            for (const l of laps) {
                                const type = l.intensity_type ? `[${l.intensity_type}] ` : ''
                                const d = l.distance_meters ? `${(l.distance_meters / 1000).toFixed(2)}km` : '?'
                                const p = l.avg_pace ? ` @ ${fmtPace(l.avg_pace)}` : ''
                                const hr = l.avg_hr ? `, HR ${l.avg_hr}` : ''
                                const comp = l.compliance_score != null ? `, compliance ${l.compliance_score}` : ''
                                systemPrompt += `  Lap ${l.lap_index + 1}: ${type}${d}${p}${hr}${comp}\n`
                            }
                        }
                    }
                }

                const estimatedInputTokens = estimateTokens(systemPrompt + JSON.stringify(messages))
                const maxTokens = calculateMaxTokens(estimatedInputTokens, providerName, 'coach')
                const allMessages = [...sessionHistory, ...messages]

                const llmRequest = {
                    messages: allMessages,
                    systemPrompt,
                    maxTokens,
                    temperature: 0.7,
                    tools: COACH_TOOLS,
                }

                // ---------------------------------------------------------------
                // LLM generation — signal the client, stream if supported
                // ---------------------------------------------------------------
                send({ type: 'status', status: 'thinking' })

                const llmStartTime = Date.now()
                let llmResponse
                if (provider.generateStream) {
                    llmResponse = await provider.generateStream(llmRequest, (chunk) => {
                        send({ type: 'text', chunk })
                    })
                } else {
                    llmResponse = await provider.generateResponse(llmRequest)
                    send({ type: 'text', chunk: llmResponse.content })
                }
                const llmDurationSec = ((Date.now() - llmStartTime) / 1000).toFixed(2)

                // ---------------------------------------------------------------
                // Parse proposals, persist, send done
                // ---------------------------------------------------------------
                const proposals: WorkoutProposal[] = (llmResponse.toolCalls ?? [])
                    .filter(tc => tc.name === 'propose_workout')
                    .map(tc => ({
                        scheduled_date: tc.arguments.scheduled_date as string,
                        workout_type: tc.arguments.workout_type as string,
                        description: tc.arguments.description as string,
                        distance_target_meters: tc.arguments.distance_target_meters as number | undefined,
                        duration_target_seconds: tc.arguments.duration_target_seconds as number | undefined,
                        intensity_target: tc.arguments.intensity_target as string | undefined,
                        structured_workout: tc.arguments.structured_workout as Record<string, unknown> | undefined,
                        rationale: tc.arguments.rationale as string,
                        is_preferred: tc.arguments.is_preferred as boolean | undefined,
                        supersedes_workout_id: tc.arguments.supersedes_workout_id as number | undefined,
                        proposal_status: 'pending' as const,
                    }))

                proposals.sort((a, b) => (b.is_preferred ? 1 : 0) - (a.is_preferred ? 1 : 0))

                writeLLMLog('coach', {
                    sessionId: currentSessionId,
                    athleteId,
                    workoutId: workoutId ?? null,
                    activityId: activityId ?? null,
                    provider: providerName,
                    model: llmResponse.model,
                    generationTimeSeconds: parseFloat(llmDurationSec),
                    estimatedInputTokens,
                    maxTokens,
                    systemPrompt,
                    messages: allMessages,
                    response: llmResponse.content,
                    toolCalls: llmResponse.toolCalls ?? [],
                    proposals,
                    usage: llmResponse.usage,
                })

                const savedMessage = await saveMessage(currentSessionId, 'assistant', llmResponse.content, {
                    provider: providerName,
                    model: llmResponse.model,
                    tokenUsage: llmResponse.usage,
                    actionTaken: proposals.length > 0 ? { proposals } : undefined,
                }, supabase)

                send({
                    type: 'done',
                    proposals,
                    sessionId: currentSessionId,
                    messageId: savedMessage.id,
                    usage: llmResponse.usage,
                    model: llmResponse.model,
                    provider: providerName,
                })
            } catch (error) {
                console.error('Coach stream error:', error)
                send({ type: 'error', error: 'Coach failed to respond' })
            } finally {
                controller.close()
            }
        }
    })

    return new Response(stream, {
        headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
    })
}
