import { LLMProvider, LLMResponse, LLMRequest, ToolCall } from '../provider-interface'
import { mapToolChoiceToOpenAI, streamOpenAICompatible } from './stream-utils'
import { toOpenAIContent } from './content-mapper'

/**
 * Apply DeepSeek's runtime thinking toggle to a request body. On deepseek-v4-*,
 * `thinking: { type: 'disabled' }` gives fast non-thinking output (the old
 * deepseek-chat behaviour) and frees the whole output budget for the answer —
 * important for large JSON. Left untouched when the caller expresses no
 * preference, so the model default applies.
 */
function applyThinking(body: Record<string, unknown>, params: LLMRequest): void {
    if (params.disableThinking === undefined) return
    body.thinking = { type: params.disableThinking ? 'disabled' : 'enabled' }
}

export class DeepSeekProvider implements LLMProvider {
    private apiKey: string
    private baseURL = 'https://api.deepseek.com/v1'

    private modelName: string

    constructor(apiKey: string, modelName?: string) {
        this.apiKey = apiKey
        // deepseek-v4-flash replaces the legacy deepseek-chat/deepseek-reasoner
        // IDs (retired 2026-07-24). Thinking is now a runtime parameter
        // (see applyThinking) rather than a model choice: Flash serves the old
        // non-thinking "chat" and thinking "reasoner" behaviours from one id.
        this.modelName = modelName || 'deepseek-v4-flash'
    }

    async generateResponse(params: LLMRequest): Promise<LLMResponse> {
        const messages: any[] = []

        // Only add system message if systemPrompt is provided
        if (params.systemPrompt) {
            messages.push({ role: 'system', content: params.systemPrompt })
        }

        for (const m of params.messages) {
            messages.push({ role: m.role, content: toOpenAIContent(m.content) })
        }

        // Convert tools to OpenAI-compatible format
        const tools = params.tools?.map(tool => ({
            type: 'function' as const,
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters
            }
        }))

        const requestBody: Record<string, unknown> = {
            model: this.modelName,
            messages,
            max_tokens: params.maxTokens || 2000,
            temperature: params.temperature || 0.7
        }

        if (tools) {
            requestBody.tools = tools
        }
        const toolChoice = mapToolChoiceToOpenAI(params.toolChoice)
        if (toolChoice) requestBody.tool_choice = toolChoice
        applyThinking(requestBody, params)

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

        const body: Record<string, unknown> = {
            model: this.modelName,
            messages,
            max_tokens: params.maxTokens || 2000,
            temperature: params.temperature || 0.7,
        }
        if (tools) body.tools = tools
        const toolChoice = mapToolChoiceToOpenAI(params.toolChoice)
        if (toolChoice) body.tool_choice = toolChoice
        applyThinking(body, params)

        return streamOpenAICompatible(
            `${this.baseURL}/chat/completions`,
            { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
            body,
            this.modelName,
            onChunk
        )
    }
}
