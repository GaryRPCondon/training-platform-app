/**
 * Token Budget Management for LLM Operations
 *
 * Manages dynamic token allocation based on:
 * - Provider capabilities (different max output tokens)
 * - Operation type (chat vs. regeneration)
 * - Context size (ensure input + output fits within limits)
 *
 * Critical for Phase 5 plan regeneration which requires 15-20K output tokens
 */

export type OperationType = 'chat' | 'regeneration' | 'coach'
export type ProviderName = 'deepseek' | 'gemini' | 'anthropic' | 'openai' | 'grok'

/**
 * Provider token limits (output/completion tokens)
 *
 * Note: These are MAXIMUM output limits. Actual usage should be lower
 * to leave headroom for context and avoid hitting hard limits.
 */
const PROVIDER_OUTPUT_LIMITS: Record<ProviderName, number> = {
  'deepseek': 32768,  // deepseek-reasoner (V3.2 thinking): 32K default, 64K max. deepseek-chat (V3.2 non-thinking): 8K max.
  'gemini': 65536,    // Gemini Flash supports up to 65K output
  'anthropic': 8192,  // Claude models typically 8K output
  'openai': 16000,    // GPT-4 Turbo supports 16K output
  'grok': 8192        // Grok supports 8K output
}

/**
 * Provider context limits (total input + output tokens)
 *
 * Used to validate that context size doesn't exceed provider capacity
 */
const PROVIDER_CONTEXT_LIMITS: Record<ProviderName, number> = {
  'deepseek': 128000,  // 128K context window
  'gemini': 1000000,   // 1M context window
  'anthropic': 200000, // 200K context window (Claude Sonnet 4.5)
  'openai': 128000,    // 128K context window (GPT-4 Turbo)
  'grok': 128000       // 128K context window
}

/**
 * Calculate appropriate maxTokens for an LLM operation
 *
 * @param estimatedInputTokens - Estimated size of system prompt + user message
 * @param providerName - LLM provider being used
 * @param operationType - Type of operation (chat or regeneration)
 * @returns Recommended maxTokens value
 *
 * @example
 * // For standard chat (short responses)
 * const maxTokens = calculateMaxTokens(2000, 'deepseek', 'chat')
 * // Returns: 4000
 *
 * @example
 * // For plan regeneration (large JSON output)
 * const maxTokens = calculateMaxTokens(5600, 'deepseek', 'regeneration')
 * // Returns: 26214 (80% of 32768 limit)
 */
export function calculateMaxTokens(
  estimatedInputTokens: number,
  providerName: string,
  operationType: OperationType
): number {
  const provider = (providerName as ProviderName) || 'deepseek'
  const maxOutput = PROVIDER_OUTPUT_LIMITS[provider] || 8192
  const maxContext = PROVIDER_CONTEXT_LIMITS[provider] || 128000

  // Validate input doesn't exceed context window
  if (estimatedInputTokens > maxContext * 0.9) {
    throw new Error(
      `Input size (${estimatedInputTokens} tokens) exceeds ${provider} context limit (${maxContext} tokens). ` +
      'Please reduce context size or simplify request.'
    )
  }

  if (operationType === 'regeneration') {
    // For regeneration: Use 80% of max output to leave safety margin
    // Regeneration produces large JSON structures (10-20K tokens)
    return Math.floor(maxOutput * 0.8)
  } else if (operationType === 'coach') {
    // For AI coach: Cap at 8K tokens — coach responses include markdown analysis
    // plus structured tool call arguments for workout proposals (5-7K typical)
    return Math.min(8000, maxOutput)
  } else {
    // For standard chat: Cap at 4K tokens for concise responses
    // Most chat responses should be 500-2000 tokens
    return Math.min(4000, maxOutput)
  }
}

/**
 * Estimate token count from text
 *
 * Uses rough approximation: 1 token ≈ 4 characters
 * This is conservative (actual ratio varies by language and content)
 *
 * @param text - Text to estimate token count for
 * @returns Estimated token count
 */
export function estimateTokens(text: string): number {
  // Rough estimate: 1 token per 4 characters (conservative)
  return Math.ceil(text.length / 4)
}

/**
 * Validate that an operation fits within token budget
 *
 * @param inputTokens - Estimated input tokens
 * @param outputTokens - Requested output tokens
 * @param providerName - LLM provider
 * @returns Object with { valid: boolean, reason?: string }
 */
export function validateTokenBudget(
  inputTokens: number,
  outputTokens: number,
  providerName: string
): { valid: boolean; reason?: string } {
  const provider = (providerName as ProviderName) || 'deepseek'
  const maxOutput = PROVIDER_OUTPUT_LIMITS[provider] || 8192
  const maxContext = PROVIDER_CONTEXT_LIMITS[provider] || 128000

  // Check output limit
  if (outputTokens > maxOutput) {
    return {
      valid: false,
      reason: `Requested output (${outputTokens} tokens) exceeds ${provider} limit (${maxOutput} tokens)`
    }
  }

  // Check context limit (input + output)
  const totalTokens = inputTokens + outputTokens
  if (totalTokens > maxContext) {
    return {
      valid: false,
      reason: `Total tokens (${totalTokens}) exceeds ${provider} context limit (${maxContext} tokens)`
    }
  }

  return { valid: true }
}

/**
 * Get recommended provider for an operation based on token requirements
 *
 * @param estimatedInputTokens - Estimated input size
 * @param estimatedOutputTokens - Estimated output size
 * @returns Recommended provider name and reason
 */
export function recommendProvider(
  estimatedInputTokens: number,
  estimatedOutputTokens: number
): { provider: ProviderName; reason: string } {
  const totalTokens = estimatedInputTokens + estimatedOutputTokens

  // For very large operations (>40K tokens total), recommend Gemini
  if (totalTokens > 40000) {
    return {
      provider: 'gemini',
      reason: 'Gemini Flash has largest context window (1M tokens) and high output limit (65K)'
    }
  }

  // For large regeneration (20-40K tokens total), recommend DeepSeek
  if (totalTokens > 20000) {
    return {
      provider: 'deepseek',
      reason: 'DeepSeek-V3 offers good balance of context (128K) and output (32K) with reasoning'
    }
  }

  // For standard operations, use DeepSeek as default
  return {
    provider: 'deepseek',
    reason: 'DeepSeek-V3 offers best value and performance for standard operations'
  }
}

/**
 * Format token budget information for logging
 */
export function formatTokenBudget(
  inputTokens: number,
  maxOutputTokens: number,
  providerName: string
): string {
  const provider = (providerName as ProviderName) || 'deepseek'
  const maxOutput = PROVIDER_OUTPUT_LIMITS[provider]
  const maxContext = PROVIDER_CONTEXT_LIMITS[provider]
  const utilizationPercent = ((inputTokens + maxOutputTokens) / maxContext * 100).toFixed(1)

  return [
    `Token Budget for ${provider}:`,
    `  Input: ${inputTokens.toLocaleString()} tokens`,
    `  Max Output: ${maxOutputTokens.toLocaleString()} tokens (${((maxOutputTokens / maxOutput) * 100).toFixed(1)}% of limit)`,
    `  Total: ${(inputTokens + maxOutputTokens).toLocaleString()} / ${maxContext.toLocaleString()} tokens (${utilizationPercent}% utilization)`
  ].join('\n')
}
