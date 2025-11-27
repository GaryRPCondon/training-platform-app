import { LLMProvider, LLMResponse, LLMRequest } from '../provider-interface'

export class GrokProvider implements LLMProvider {
    private apiKey: string
    private baseURL = 'https://api.x.ai/v1'

    private modelName: string

    constructor(apiKey: string, modelName?: string) {
        this.apiKey = apiKey
        this.modelName = modelName || 'grok-beta'
    }

    async generateResponse(params: LLMRequest): Promise<LLMResponse> {
        const messages = [
            { role: 'system', content: params.systemPrompt },
            ...params.messages
        ]

        const response = await fetch(`${this.baseURL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: JSON.stringify({
                model: this.modelName,
                messages,
                max_tokens: params.maxTokens || 2000,
                temperature: params.temperature || 0.7
            })
        })

        if (!response.ok) {
            throw new Error(`Grok API error: ${response.statusText}`)
        }

        const data = await response.json()

        return {
            content: data.choices[0].message.content,
            model: 'grok-beta',
            usage: {
                inputTokens: data.usage?.prompt_tokens || 0,
                outputTokens: data.usage?.completion_tokens || 0
            }
        }
    }
}
