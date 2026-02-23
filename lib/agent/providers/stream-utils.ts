/**
 * Shared streaming helper for OpenAI-compatible SSE APIs
 * (DeepSeek, OpenAI, Grok all use identical format).
 *
 * Calls onChunk for each text delta, accumulates tool call deltas,
 * and returns the complete LLMResponse once the stream ends.
 */

import { LLMResponse, ToolCall } from '../provider-interface'

interface ToolCallAccumulator {
    id: string
    name: string
    arguments: string
}

export async function streamOpenAICompatible(
    url: string,
    headers: Record<string, string>,
    body: object,
    modelName: string,
    onChunk: (text: string) => void
): Promise<LLMResponse> {
    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...body, stream: true }),
    })

    if (!response.ok || !response.body) {
        const err = await response.json().catch(() => ({}))
        throw new Error(`API error: ${err.error?.message ?? response.statusText}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let fullContent = ''
    let inputTokens = 0
    let outputTokens = 0
    const toolCallAccumulators = new Map<number, ToolCallAccumulator>()

    while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6).trim()
            if (data === '[DONE]') continue

            try {
                const parsed = JSON.parse(data)

                // Usage may arrive in the final chunk (OpenAI format)
                if (parsed.usage) {
                    inputTokens = parsed.usage.prompt_tokens ?? inputTokens
                    outputTokens = parsed.usage.completion_tokens ?? outputTokens
                }

                const delta = parsed.choices?.[0]?.delta
                if (!delta) continue

                // Text content
                if (delta.content) {
                    fullContent += delta.content
                    onChunk(delta.content)
                }

                // Tool call deltas — accumulate by index
                if (delta.tool_calls) {
                    for (const tc of delta.tool_calls) {
                        const idx: number = tc.index ?? 0
                        if (!toolCallAccumulators.has(idx)) {
                            toolCallAccumulators.set(idx, { id: '', name: '', arguments: '' })
                        }
                        const acc = toolCallAccumulators.get(idx)!
                        if (tc.id) acc.id = tc.id
                        if (tc.function?.name) acc.name += tc.function.name
                        if (tc.function?.arguments) acc.arguments += tc.function.arguments
                    }
                }
            } catch {
                // Malformed chunk — skip
            }
        }
    }

    // Parse accumulated tool calls
    const toolCalls: ToolCall[] = []
    for (const acc of Array.from(toolCallAccumulators.values())) {
        try {
            toolCalls.push({
                id: acc.id,
                name: acc.name,
                arguments: JSON.parse(acc.arguments),
            })
        } catch {
            // Skip malformed tool call
        }
    }

    return {
        content: fullContent,
        model: modelName,
        usage: { inputTokens, outputTokens },
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    }
}
