import Anthropic from '@anthropic-ai/sdk'
import { LLMProvider, LLMRequest, LLMResponse } from '../provider-interface'

export class AnthropicProvider implements LLMProvider {
    private client: Anthropic

    private modelName: string

    constructor(apiKey: string, modelName?: string) {
        this.client = new Anthropic({ apiKey })
        this.modelName = modelName || 'claude-sonnet-4-5-20250929'
    }

    async generateResponse(request: LLMRequest): Promise<LLMResponse> {
        const systemMessage = request.systemPrompt
        const messages = request.messages
            .filter(m => m.role !== 'system')
            .map(m => ({
                role: m.role as 'user' | 'assistant',
                content: m.content,
            }))

        const response = await this.client.messages.create({
            model: this.modelName,
            max_tokens: request.maxTokens || 1024,
            temperature: request.temperature,
            system: systemMessage,
            messages: messages,
        })

        return {
            content: response.content[0].type === 'text' ? response.content[0].text : '',
            model: response.model,
            usage: {
                inputTokens: response.usage.input_tokens,
                outputTokens: response.usage.output_tokens,
            },
        }
    }
}
