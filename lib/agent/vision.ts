/**
 * Vision provider routing.
 *
 * Vision (screenshot/photo) parsing is deliberately DECOUPLED from the user's
 * general LLM provider. The general provider is chosen for chat / AI summaries /
 * coaching / text parsing (e.g. DeepSeek) and may be text-only or expensive;
 * vision wants a cheap, capable multimodal model. So vision always uses a
 * dedicated vision provider — default Google Gemini Flash — regardless of the
 * athlete's configured LLM. Any future vision task should reuse this resolver.
 *
 * Resolution order:
 *   1. IMPORT_VISION_PROVIDER + IMPORT_VISION_MODEL (both set) — explicit override.
 *   2. The first candidate below whose API key is configured (cost order).
 *   3. Otherwise throw VisionUnavailableError so the caller surfaces a clear message.
 *
 * DeepSeek and Grok are intentionally absent: DeepSeek's API has no image input,
 * and Grok vision isn't validated for this app. Confirm exact ids with
 * scripts/verify-vision-models.mjs; gemini-2.5-flash is the default (chosen for
 * price — bump via IMPORT_VISION_MODEL or the candidate list if needed).
 */

export interface VisionTarget {
  provider: string
  model: string
}

export class VisionUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VisionUnavailableError'
  }
}

// Cost/preference order: Gemini Flash first (cheap + capable), then GPT-4o, then
// Claude. Each is only selected when its API key is present.
const VISION_CANDIDATES: Array<{ provider: string; model: string; envKey: string }> = [
  { provider: 'gemini', model: 'gemini-2.5-flash', envKey: 'GEMINI_API_KEY' },
  { provider: 'openai', model: 'gpt-4o', envKey: 'OPENAI_API_KEY' },
  { provider: 'anthropic', model: 'claude-opus-4-8', envKey: 'ANTHROPIC_API_KEY' },
]

/**
 * Resolve the dedicated vision provider+model for an image parse. Independent of
 * the athlete's general LLM provider.
 */
export function resolveVisionModel(): VisionTarget {
  const envProvider = process.env.IMPORT_VISION_PROVIDER
  const envModel = process.env.IMPORT_VISION_MODEL
  if (envProvider && envModel) {
    return { provider: envProvider, model: envModel }
  }

  for (const c of VISION_CANDIDATES) {
    if (process.env[c.envKey]) return { provider: c.provider, model: c.model }
  }

  throw new VisionUnavailableError(
    'Screenshot import needs a vision-capable provider. Set GEMINI_API_KEY (recommended), OPENAI_API_KEY, or ANTHROPIC_API_KEY — or set IMPORT_VISION_PROVIDER and IMPORT_VISION_MODEL.',
  )
}
