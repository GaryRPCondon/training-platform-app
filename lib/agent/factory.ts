import { LLMProvider } from './provider-interface'
import { GeminiProvider } from './providers/gemini'
import { AnthropicProvider } from './providers/anthropic'
import { OpenAIProvider } from './providers/openai'
import { DeepSeekProvider } from './providers/deepseek'
import { GrokProvider } from './providers/grok'

export function createLLMProvider(providerName: string = 'deepseek', modelName?: string): LLMProvider {
    switch (providerName.toLowerCase()) {
        case 'anthropic':
            if (!process.env.ANTHROPIC_API_KEY) throw new Error('Anthropic Claude is not available. Please select a different AI provider in your Profile settings.')
            return new AnthropicProvider(process.env.ANTHROPIC_API_KEY, modelName)

        case 'openai':
            if (!process.env.OPENAI_API_KEY) throw new Error('OpenAI is not available. Please select a different AI provider in your Profile settings.')
            return new OpenAIProvider(process.env.OPENAI_API_KEY, modelName)

        case 'grok':
            if (!process.env.XAI_API_KEY) throw new Error('xAI Grok is not available. Please select a different AI provider in your Profile settings.')
            return new GrokProvider(process.env.XAI_API_KEY, modelName)

        case 'gemini':
            if (!process.env.GEMINI_API_KEY) throw new Error('Google Gemini is not available. Please select a different AI provider in your Profile settings.')
            return new GeminiProvider(process.env.GEMINI_API_KEY, modelName)

        case 'deepseek':
        default:
            if (!process.env.DEEPSEEK_API_KEY) throw new Error('DeepSeek is not available. Please select a different AI provider in your Profile settings.')
            return new DeepSeekProvider(process.env.DEEPSEEK_API_KEY, modelName)
    }
}
