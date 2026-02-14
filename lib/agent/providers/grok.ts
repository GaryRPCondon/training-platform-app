import { LLMProvider, LLMResponse, LLMRequest, ToolCall } from '../provider-interface'

export class GrokProvider implements LLMProvider {
    private apiKey: string
    private baseURL = 'https://api.x.ai/v1'

    private modelName: string

    constructor(apiKey: string, modelName?: string) {
        this.apiKey = apiKey
        this.modelName = modelName || 'grok-4-1-fast-non-reasoning'
    }

    async generateResponse(params: LLMRequest): Promise<LLMResponse> {
        const messages = [
            { role: 'system', content: params.systemPrompt },
            ...params.messages
        ]

        // Convert tools to OpenAI-compatible format
        const tools = params.tools?.map(tool => ({
            type: 'function' as const,
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters
            }
        }))

        const requestBody: any = {
            model: this.modelName,
            messages,
            max_tokens: params.maxTokens || 2000,
            temperature: params.temperature || 0.7
        }

        if (tools) {
            requestBody.tools = tools
        }

        const response = await fetch(`${this.baseURL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: JSON.stringify(requestBody)
        })

        if (!response.ok) {
            throw new Error(`Grok API error: ${response.statusText}`)
        }

        const data = await response.json()
        const message = data.choices[0].message

        // Extract tool calls (OpenAI-compatible format)
        const toolCalls: ToolCall[] = []
        if (message?.tool_calls) {
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
            model: this.modelName,
            usage: {
                inputTokens: data.usage?.prompt_tokens || 0,
                outputTokens: data.usage?.completion_tokens || 0
            },
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined
        }
    }
}
