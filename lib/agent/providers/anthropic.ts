import Anthropic from '@anthropic-ai/sdk'
import { LLMProvider, LLMRequest, LLMResponse, ToolCall } from '../provider-interface'

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

        // Convert tools to Anthropic's format
        const tools = request.tools?.map(tool => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.parameters
        }))

        // Use streaming to handle long requests (>10 minutes)
        // See: https://github.com/anthropics/anthropic-sdk-typescript#long-requests
        const stream = this.client.messages.stream({
            model: this.modelName,
            max_tokens: request.maxTokens || 1024,
            temperature: request.temperature,
            system: systemMessage,
            messages: messages,
            tools: tools as any
        })

        // Accumulate the streamed response
        const response = await stream.finalMessage()

        // Extract text content
        let text = ''
        const toolCalls: ToolCall[] = []

        for (const block of response.content) {
            if (block.type === 'text') {
                text += block.text
            } else if (block.type === 'tool_use') {
                toolCalls.push({
                    id: block.id,
                    name: block.name,
                    arguments: block.input as Record<string, unknown>
                })
            }
        }

        return {
            content: text,
            model: response.model,
            usage: {
                inputTokens: response.usage.input_tokens,
                outputTokens: response.usage.output_tokens,
            },
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined
        }
    }
}
