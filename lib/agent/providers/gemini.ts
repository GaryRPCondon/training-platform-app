import { GoogleGenerativeAI } from '@google/generative-ai'
import { LLMProvider, LLMRequest, LLMResponse, ToolCall } from '../provider-interface'

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

export class GeminiProvider implements LLMProvider {
    private client: GoogleGenerativeAI
    private modelName: string

    constructor(apiKey: string, modelName?: string) {
        this.client = new GoogleGenerativeAI(apiKey)
        this.modelName = modelName || 'gemini-flash-latest'
    }

    async generateResponse(request: LLMRequest): Promise<LLMResponse> {
        // Convert tools to Gemini's functionDeclarations format
        // Strip out unsupported JSON Schema fields like additionalProperties
        const tools = request.tools ? [{
            functionDeclarations: request.tools.map(tool => ({
                name: tool.name,
                description: tool.description,
                parameters: cleanSchemaForGemini(tool.parameters)
            }))
        }] : undefined

        const model = this.client.getGenerativeModel({
            model: this.modelName,
            generationConfig: {
                maxOutputTokens: request.maxTokens || 8192,
                temperature: request.temperature ?? 1.0,
            },
            tools: tools as any
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
}
