import OpenAI from 'openai'
import { LLMProvider, LLMRequest, LLMResponse } from '../provider-interface'

export class OpenAIProvider implements LLMProvider {
    private client: OpenAI

    private modelName: string

    constructor(apiKey: string, modelName?: string) {
        this.client = new OpenAI({ apiKey })
        this.modelName = modelName || 'gpt-4o'
    }

    async generateResponse(request: LLMRequest): Promise<LLMResponse> {
        const messages = request.messages.map(m => ({
            role: m.role as 'user' | 'assistant' | 'system',
            content: m.content,
        }))

        if (request.systemPrompt) {
            messages.unshift({
                role: 'system',
                content: request.systemPrompt,
            })
        }

        const response = await this.client.chat.completions.create({
            model: this.modelName,
            messages: messages,
            max_tokens: request.maxTokens,
            temperature: request.temperature,
        })

        return {
            content: response.choices[0].message.content || '',
            model: response.model,
            usage: {
                inputTokens: response.usage?.prompt_tokens || 0,
                outputTokens: response.usage?.completion_tokens || 0,
            },
        }
    }
}
