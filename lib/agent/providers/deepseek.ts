import { LLMProvider, LLMResponse, LLMRequest } from '../provider-interface'

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

        // If still empty, throw an error
        if (!content) {
            console.error('DeepSeek returned empty content. Full response:', JSON.stringify(data, null, 2))
            throw new Error('DeepSeek returned empty response. The model may be overloaded or the request timed out.')
        }

        return {
            content,
            model: this.modelName,
            usage: {
                inputTokens: data.usage?.prompt_tokens || 0,
                outputTokens: data.usage?.completion_tokens || 0
            }
        }
    }
}
