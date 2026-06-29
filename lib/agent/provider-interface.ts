export interface ToolDefinition {
    name: string
    description: string
    parameters: Record<string, unknown>  // JSON Schema
}

export interface ToolCall {
    id: string
    name: string
    arguments: Record<string, unknown>
}

export interface LLMResponse {
    content: string
    model: string
    usage: {
        inputTokens: number
        outputTokens: number
    }
    toolCalls?: ToolCall[]
}

export type TextPart = { type: 'text'; text: string }
export type ImagePart = { type: 'image'; mimeType: string; dataBase64: string }
// Message content is either a plain string (the common case — all existing
// callers) or an array of parts for multimodal requests (text + images).
export type MessageContent = string | Array<TextPart | ImagePart>

export interface LLMRequest {
    messages: {
        role: 'user' | 'assistant' | 'system'
        content: MessageContent
    }[]
    systemPrompt?: string
    maxTokens?: number
    temperature?: number
    tools?: ToolDefinition[]
    toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } }
}

export interface LLMProvider {
    generateResponse(request: LLMRequest): Promise<LLMResponse>
    /**
     * Optional streaming variant. Calls onChunk for each text token as it
     * arrives, then returns the full LLMResponse (including tool calls) once
     * the stream ends. Providers that don't implement this fall back to
     * generateResponse() with the full text sent as a single chunk.
     */
    generateStream?(
        request: LLMRequest,
        onChunk: (text: string) => void
    ): Promise<LLMResponse>
}
