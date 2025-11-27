import { GoogleGenerativeAI } from '@google/generative-ai'
import { LLMProvider, LLMRequest, LLMResponse } from '../provider-interface'

export class GeminiProvider implements LLMProvider {
    private client: GoogleGenerativeAI
    private modelName: string

    constructor(apiKey: string, modelName?: string) {
        this.client = new GoogleGenerativeAI(apiKey)
        this.modelName = modelName || 'gemini-1.5-pro'
    }

    async generateResponse(request: LLMRequest): Promise<LLMResponse> {
        const model = this.client.getGenerativeModel({ model: this.modelName })

        const chat = model.startChat({
            history: request.messages
                .filter(m => m.role !== 'system')
                .map(m => ({
                    role: m.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: m.content }],
                })),
        })

        let lastMessage = request.messages[request.messages.length - 1].content
        if (request.systemPrompt) {
            lastMessage = `${request.systemPrompt}\n\nUser: ${lastMessage}`
        }

        const result = await chat.sendMessage(lastMessage)
        const response = await result.response
        const text = response.text()

        return {
            content: text,
            model: this.modelName,
            usage: {
                inputTokens: 0,
                outputTokens: 0,
            },
        }
    }
}
