import { GoogleGenerativeAI } from '@google/generative-ai'
import { LLMProvider, LLMRequest, LLMResponse, ToolCall, ToolDefinition } from '../provider-interface'

/**
 * Clean JSON Schema for Gemini compatibility
 * Gemini doesn't support certain JSON Schema keywords like additionalProperties
 */
function cleanSchemaForGemini(schema: Record<string, unknown>): Record<string, unknown> {
    const cleaned: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(schema)) {
        // Skip unsupported fields
        if (key === 'additionalProperties') {
            continue
        }

        // Recursively clean nested objects
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            cleaned[key] = cleanSchemaForGemini(value as Record<string, unknown>)
        } else if (Array.isArray(value)) {
            // Handle arrays (e.g., oneOf, items)
            cleaned[key] = value.map(item =>
                item && typeof item === 'object'
                    ? cleanSchemaForGemini(item as Record<string, unknown>)
                    : item
            )
        } else {
            cleaned[key] = value
        }
    }

    return cleaned
}

function mapToolChoiceToGeminiConfig(
    toolChoice: LLMRequest['toolChoice']
): { functionCallingConfig: { mode: string; allowedFunctionNames?: string[] } } | undefined {
    if (!toolChoice) return undefined
    if (toolChoice === 'auto') return { functionCallingConfig: { mode: 'AUTO' } }
    if (toolChoice === 'none') return { functionCallingConfig: { mode: 'NONE' } }
    return {
        functionCallingConfig: {
            mode: 'ANY',
            allowedFunctionNames: [toolChoice.function.name],
        },
    }
}

/**
 * If the request forces exactly one named function, look it up in the
 * tools list so we can route through Gemini's structured-output mode
 * (more reliable than mode='ANY' function calling for array-of-object
 * schemas, which often returns MALFORMED_FUNCTION_CALL).
 */
function getForcedToolDefinition(request: LLMRequest): ToolDefinition | null {
    const choice = request.toolChoice
    if (!choice || typeof choice === 'string') return null
    return request.tools?.find(t => t.name === choice.function.name) ?? null
}

export class GeminiProvider implements LLMProvider {
    private client: GoogleGenerativeAI
    private modelName: string

    constructor(apiKey: string, modelName?: string) {
        this.client = new GoogleGenerativeAI(apiKey)
        this.modelName = modelName || 'gemini-2.5-flash'
    }

    async generateResponse(request: LLMRequest): Promise<LLMResponse> {
        // When the caller forces a specific function, route through Gemini's
        // structured-output mode (responseSchema + responseMimeType) rather
        // than function calling. Function calling on gemini-2.5-flash with
        // mode='ANY' frequently emits MALFORMED_FUNCTION_CALL on
        // array-of-object schemas; structured output doesn't have that
        // failure mode because there's no function-call envelope to corrupt.
        const forcedTool = getForcedToolDefinition(request)
        if (forcedTool) {
            return this.generateForcedToolResponse(request, forcedTool)
        }

        // Convert tools to Gemini's functionDeclarations format
        // Strip out unsupported JSON Schema fields like additionalProperties
        const tools = request.tools ? [{
            functionDeclarations: request.tools.map(tool => ({
                name: tool.name,
                description: tool.description,
                parameters: cleanSchemaForGemini(tool.parameters)
            }))
        }] : undefined

        const toolConfig = mapToolChoiceToGeminiConfig(request.toolChoice)

        const model = this.client.getGenerativeModel({
            model: this.modelName,
            generationConfig: {
                maxOutputTokens: request.maxTokens || 8192,
                temperature: request.temperature ?? 1.0,
            },
            tools: tools as any,
            toolConfig: toolConfig as any,
        })

        const chat = model.startChat({
            history: request.messages
                .filter(m => m.role !== 'system')
                .map(m => ({
                    role: m.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: m.content }],
                })),
        })

        let lastMessage = request.messages[request.messages.length - 1].content
        if (request.systemPrompt) {
            lastMessage = `${request.systemPrompt}\n\nUser: ${lastMessage}`
        }

        const result = await chat.sendMessage(lastMessage)
        const response = await result.response

        // Extract text content
        let text = ''
        try {
            text = response.text()
        } catch (e) {
            // If response.text() fails, it might be because there's only function calls
            text = ''
        }

        // Extract function calls from response
        const toolCalls: ToolCall[] = []
        const candidates = response.candidates || []

        for (const candidate of candidates) {
            const parts = candidate.content?.parts || []
            for (const part of parts) {
                if ('functionCall' in part && part.functionCall) {
                    toolCalls.push({
                        id: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        name: part.functionCall.name,
                        arguments: (part.functionCall.args || {}) as Record<string, unknown>
                    })
                }
            }
        }

        // Get token usage from response
        const usageMetadata = response.usageMetadata
        const inputTokens = usageMetadata?.promptTokenCount || 0
        const outputTokens = usageMetadata?.candidatesTokenCount || 0

        if (!text && toolCalls.length === 0) {
            const finishReason = candidates[0]?.finishReason ?? 'unknown'
            const safety = candidates[0]?.safetyRatings
            console.error('Gemini empty response — raw candidate:', JSON.stringify(candidates[0], null, 2))
            throw new Error(
                `Gemini returned empty response (finishReason=${finishReason}). ` +
                `outputTokens=${outputTokens}. ` +
                `Likely causes: MAX_TOKENS (raise maxTokens), SAFETY (${JSON.stringify(safety)}), ` +
                `MALFORMED_FUNCTION_CALL (schema mismatch — see server logs for raw candidate), ` +
                `or the model declined to call the requested function.`
            )
        }

        return {
            content: text,
            model: this.modelName,
            usage: {
                inputTokens,
                outputTokens,
            },
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined
        }
    }

    /**
     * Forced-tool path: use Gemini's structured-output mode and synthesize
     * a ToolCall from the JSON output so callers see the same response shape
     * as the function-calling path. This avoids MALFORMED_FUNCTION_CALL on
     * large array-of-object schemas.
     */
    private async generateForcedToolResponse(
        request: LLMRequest,
        tool: ToolDefinition,
    ): Promise<LLMResponse> {
        const responseSchema = cleanSchemaForGemini(tool.parameters)

        // gemini-2.5-flash is a "thinking" model — internal reasoning tokens
        // count against maxOutputTokens, so a large schema can have its JSON
        // output truncated mid-string while the visible text looks small.
        // For structured-output mode we don't need thinking (schema enforces
        // shape, temperature is low), so disable it via thinkingBudget: 0.
        const model = this.client.getGenerativeModel({
            model: this.modelName,
            generationConfig: {
                maxOutputTokens: request.maxTokens || 8192,
                temperature: request.temperature ?? 1.0,
                responseMimeType: 'application/json',
                responseSchema: responseSchema as any,
                thinkingConfig: { thinkingBudget: 0 },
            } as any,
        })

        const chat = model.startChat({
            history: request.messages
                .filter(m => m.role !== 'system')
                .map(m => ({
                    role: m.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: m.content }],
                })),
        })

        let lastMessage = request.messages[request.messages.length - 1].content
        const directive = `\n\nReturn ONLY a JSON object matching the schema for the "${tool.name}" function. Do not include prose, markdown, or code fences.`
        if (request.systemPrompt) {
            lastMessage = `${request.systemPrompt}${directive}\n\nUser: ${lastMessage}`
        } else {
            lastMessage = `${lastMessage}${directive}`
        }

        const result = await chat.sendMessage(lastMessage)
        const response = await result.response

        let text = ''
        try { text = response.text() } catch { text = '' }

        const candidates = response.candidates || []
        const usageMetadata = response.usageMetadata
        const inputTokens = usageMetadata?.promptTokenCount || 0
        const outputTokens = usageMetadata?.candidatesTokenCount || 0

        if (!text) {
            const finishReason = candidates[0]?.finishReason ?? 'unknown'
            const safety = candidates[0]?.safetyRatings
            console.error('Gemini structured-output empty — raw candidate:', JSON.stringify(candidates[0], null, 2))
            throw new Error(
                `Gemini returned empty structured-output response (finishReason=${finishReason}, outputTokens=${outputTokens}). ` +
                `Safety: ${JSON.stringify(safety)}.`
            )
        }

        let parsed: Record<string, unknown>
        try {
            parsed = JSON.parse(text)
        } catch (e) {
            console.error('Gemini structured-output JSON parse failed. Raw text:', text)
            throw new Error(`Gemini structured-output did not return valid JSON: ${(e as Error).message}`)
        }

        const toolCall: ToolCall = {
            id: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name: tool.name,
            arguments: parsed,
        }

        return {
            content: '',
            model: this.modelName,
            usage: { inputTokens, outputTokens },
            toolCalls: [toolCall],
        }
    }

    async generateStream(request: LLMRequest, onChunk: (text: string) => void): Promise<LLMResponse> {
        const tools = request.tools ? [{
            functionDeclarations: request.tools.map(tool => ({
                name: tool.name,
                description: tool.description,
                parameters: cleanSchemaForGemini(tool.parameters)
            }))
        }] : undefined

        const toolConfig = mapToolChoiceToGeminiConfig(request.toolChoice)

        const model = this.client.getGenerativeModel({
            model: this.modelName,
            generationConfig: {
                maxOutputTokens: request.maxTokens || 8192,
                temperature: request.temperature ?? 1.0,
            },
            tools: tools as any,
            toolConfig: toolConfig as any,
        })

        const chat = model.startChat({
            history: request.messages
                .filter(m => m.role !== 'system')
                .map(m => ({
                    role: m.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: m.content }],
                })),
        })

        let lastMessage = request.messages[request.messages.length - 1].content
        if (request.systemPrompt) {
            lastMessage = `${request.systemPrompt}\n\nUser: ${lastMessage}`
        }

        const result = await chat.sendMessageStream(lastMessage)

        let fullText = ''
        const toolCalls: ToolCall[] = []

        for await (const chunk of result.stream) {
            // Extract text chunks
            const chunkText = chunk.text()
            if (chunkText) {
                fullText += chunkText
                onChunk(chunkText)
            }

            // Extract function calls from streamed chunks
            const parts = chunk.candidates?.[0]?.content?.parts || []
            for (const part of parts) {
                if ('functionCall' in part && part.functionCall) {
                    toolCalls.push({
                        id: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        name: part.functionCall.name,
                        arguments: (part.functionCall.args || {}) as Record<string, unknown>
                    })
                }
            }
        }

        // Get final usage from the aggregated response
        const aggregated = await result.response
        const usageMetadata = aggregated.usageMetadata
        const inputTokens = usageMetadata?.promptTokenCount || 0
        const outputTokens = usageMetadata?.candidatesTokenCount || 0

        return {
            content: fullText,
            model: this.modelName,
            usage: { inputTokens, outputTokens },
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined
        }
    }
}
