export interface LLMResponse {
    content: string
    model: string
    usage: {
        inputTokens: number
        outputTokens: number
    }
}

export interface LLMRequest {
    messages: {
        role: 'user' | 'assistant' | 'system'
        content: string
    }[]
    systemPrompt?: string
    maxTokens?: number
    temperature?: number
}

export interface LLMProvider {
    generateResponse(request: LLMRequest): Promise<LLMResponse>
}
