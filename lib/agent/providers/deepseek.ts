import { LLMProvider, LLMResponse, LLMRequest, ToolCall } from '../provider-interface'
import { streamOpenAICompatible } from './stream-utils'

export class DeepSeekProvider implements LLMProvider {
    private apiKey: string
    private baseURL = 'https://api.deepseek.com/v1'

    private modelName: string

    constructor(apiKey: string, modelName?: string) {
        this.apiKey = apiKey
        this.modelName = modelName || 'deepseek-reasoner'
    }

    async generateResponse(params: LLMRequest): Promise<LLMResponse> {
        const messages: any[] = []

        // Only add system message if systemPrompt is provided
        if (params.systemPrompt) {
            messages.push({ role: 'system', content: params.systemPrompt })
        }

        messages.push(...params.messages)

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
            const errorData = await response.json().catch(() => ({}))
            const errorMessage = errorData.error?.message || errorData.message || response.statusText
            console.error('DeepSeek API error details:', errorData)
            throw new Error(`DeepSeek API error: ${errorMessage}`)
        }

        const data = await response.json()

        // Handle different DeepSeek model response formats
        // deepseek-reasoner (R1) may return reasoning_content + content
        const message = data.choices?.[0]?.message
        let content = message?.content || ''

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

        // If content is empty but reasoning_content exists (R1 model),
        // the model might have put the response there
        if (!content && message?.reasoning_content) {
            // Try to extract JSON from reasoning content
            const jsonMatch = message.reasoning_content.match(/```json\s*([\s\S]*?)\s*```/)
            if (jsonMatch) {
                content = jsonMatch[1]
            } else {
                // Try to find any JSON object in the reasoning
                const objMatch = message.reasoning_content.match(/\{[\s\S]*\}/)
                if (objMatch) {
                    content = objMatch[0]
                }
            }
        }

        // If still empty and no tool calls, throw an error
        if (!content && toolCalls.length === 0) {
            console.error('DeepSeek returned empty content. Full response:', JSON.stringify(data, null, 2))
            throw new Error('DeepSeek returned empty response. The model may be overloaded or the request timed out.')
        }

        return {
            content,
            model: this.modelName,
            usage: {
                inputTokens: data.usage?.prompt_tokens || 0,
                outputTokens: data.usage?.completion_tokens || 0
            },
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined
        }
    }

    async generateStream(params: LLMRequest, onChunk: (text: string) => void): Promise<LLMResponse> {
        const messages: any[] = []
        if (params.systemPrompt) messages.push({ role: 'system', content: params.systemPrompt })
        messages.push(...params.messages)

        const tools = params.tools?.map(tool => ({
            type: 'function' as const,
            function: { name: tool.name, description: tool.description, parameters: tool.parameters }
        }))

        const body: any = {
            model: this.modelName,
            messages,
            max_tokens: params.maxTokens || 2000,
            temperature: params.temperature || 0.7,
        }
        if (tools) body.tools = tools

        return streamOpenAICompatible(
            `${this.baseURL}/chat/completions`,
            { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
            body,
            this.modelName,
            onChunk
        )
    }
}
