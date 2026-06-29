import type { MessageContent } from '../provider-interface'

/**
 * Per-provider converters for multimodal message content. Each takes our
 * provider-agnostic MessageContent (string | parts[]) and emits the shape the
 * given provider's SDK/API expects. Strings pass through so existing text-only
 * callers are unaffected.
 */

// --- OpenAI-compatible (OpenAI, DeepSeek-VL, Grok) -------------------------
export type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export function toOpenAIContent(content: MessageContent): string | OpenAIContentPart[] {
  if (typeof content === 'string') return content
  return content.map<OpenAIContentPart>(p =>
    p.type === 'text'
      ? { type: 'text', text: p.text }
      : { type: 'image_url', image_url: { url: `data:${p.mimeType};base64,${p.dataBase64}` } },
  )
}

// --- Anthropic ------------------------------------------------------------
export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

export function toAnthropicContent(content: MessageContent): string | AnthropicContentBlock[] {
  if (typeof content === 'string') return content
  return content.map<AnthropicContentBlock>(p =>
    p.type === 'text'
      ? { type: 'text', text: p.text }
      : { type: 'image', source: { type: 'base64', media_type: p.mimeType, data: p.dataBase64 } },
  )
}

// --- Gemini (@google/generative-ai Part[]) --------------------------------
export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }

export function toGeminiParts(content: MessageContent): GeminiPart[] {
  if (typeof content === 'string') return [{ text: content }]
  return content.map<GeminiPart>(p =>
    p.type === 'text' ? { text: p.text } : { inlineData: { mimeType: p.mimeType, data: p.dataBase64 } },
  )
}

/** Flatten content to plain text (drops images) — for text-only code paths. */
export function flattenToText(content: MessageContent): string {
  if (typeof content === 'string') return content
  return content.filter((p): p is { type: 'text'; text: string } => p.type === 'text').map(p => p.text).join('\n')
}

/** True when any part is an image. */
export function hasImageParts(content: MessageContent): boolean {
  return typeof content !== 'string' && content.some(p => p.type === 'image')
}
