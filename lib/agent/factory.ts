import { LLMProvider } from './provider-interface'
import { GeminiProvider } from './providers/gemini'
import { AnthropicProvider } from './providers/anthropic'
import { OpenAIProvider } from './providers/openai'
import { DeepSeekProvider } from './providers/deepseek'
import { GrokProvider } from './providers/grok'

export function createLLMProvider(providerName: string = 'deepseek', modelName?: string): LLMProvider {
    switch (providerName.toLowerCase()) {
        case 'anthropic':
            if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set')
            return new AnthropicProvider(process.env.ANTHROPIC_API_KEY, modelName)

        case 'openai':
            if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set')
            return new OpenAIProvider(process.env.OPENAI_API_KEY, modelName)

        case 'grok':
            if (!process.env.XAI_API_KEY) throw new Error('XAI_API_KEY not set')
            return new GrokProvider(process.env.XAI_API_KEY, modelName)

        case 'gemini':
            if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set')
            return new GeminiProvider(process.env.GEMINI_API_KEY, modelName)

        case 'deepseek':
        default:
            if (!process.env.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY not set')
            return new DeepSeekProvider(process.env.DEEPSEEK_API_KEY, modelName)
    }
}
