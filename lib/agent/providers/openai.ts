import OpenAI from 'openai'
import { LLMProvider, LLMRequest, LLMResponse, ToolCall } from '../provider-interface'
import { streamOpenAICompatible } from './stream-utils'

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

        // Convert tools to OpenAI's format
        const tools = request.tools?.map(tool => ({
            type: 'function' as const,
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters
            }
        }))

        const response = await this.client.chat.completions.create({
            model: this.modelName,
            messages: messages,
            max_tokens: request.maxTokens,
            temperature: request.temperature,
            tools: tools as any
        })

        const message = response.choices[0].message

        // Extract tool calls
        const toolCalls: ToolCall[] = []
        if (message.tool_calls) {
            for (const tc of message.tool_calls) {
                if (tc.type === 'function') {
                    toolCalls.push({
                        id: tc.id,
                        name: tc.function.name,
                        arguments: JSON.parse(tc.function.arguments)
                    })
                }
            }
        }

        return {
            content: message.content || '',
            model: response.model,
            usage: {
                inputTokens: response.usage?.prompt_tokens || 0,
                outputTokens: response.usage?.completion_tokens || 0,
            },
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined
        }
    }

    async generateStream(request: LLMRequest, onChunk: (text: string) => void): Promise<LLMResponse> {
        const messages: any[] = []
        if (request.systemPrompt) messages.push({ role: 'system', content: request.systemPrompt })
        messages.push(...request.messages)

        const tools = request.tools?.map(tool => ({
            type: 'function' as const,
            function: { name: tool.name, description: tool.description, parameters: tool.parameters }
        }))

        const body: any = {
            model: this.modelName,
            messages,
            max_tokens: request.maxTokens,
            temperature: request.temperature,
        }
        if (tools) body.tools = tools

        return streamOpenAICompatible(
            'https://api.openai.com/v1/chat/completions',
            { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
            body,
            this.modelName,
            onChunk
        )
    }
}
