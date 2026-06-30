/**
 * Vision provider routing.
 *
 * Vision (screenshot/photo) parsing is deliberately DECOUPLED from the user's
 * general LLM provider. The general provider is chosen for chat / AI summaries /
 * coaching / text parsing (e.g. DeepSeek) and may be text-only or expensive;
 * vision wants a cheap, capable multimodal model. So vision uses its own
 * provider, configurable per-user in Settings → AI Configuration. Any future
 * vision task should reuse this resolver.
 *
 * Resolution order:
 *   1. An explicit per-user selection (provider, optional model) — from settings.
 *   2. IMPORT_VISION_PROVIDER + IMPORT_VISION_MODEL (both set) — ops/dev override.
 *   3. The first candidate below whose API key is configured (cost order).
 *   4. Otherwise throw VisionUnavailableError so the caller surfaces a clear message.
 *
 * DeepSeek and Grok are intentionally absent: DeepSeek's API has no image input,
 * and Grok vision isn't validated for this app. Confirm exact ids with
 * scripts/verify-vision-models.mjs; gemini-2.5-flash is the default (chosen for
 * price — change via Settings, IMPORT_VISION_MODEL, or the candidate list).
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
// Claude. Each is only selected when its API key is present. The model here is
// also the per-provider default used when a user picks a provider but leaves the
// vision model override blank.
const VISION_CANDIDATES: Array<{ provider: string; model: string; envKey: string }> = [
  { provider: 'gemini', model: 'gemini-2.5-flash', envKey: 'GEMINI_API_KEY' },
  { provider: 'openai', model: 'gpt-4o', envKey: 'OPENAI_API_KEY' },
  { provider: 'anthropic', model: 'claude-opus-4-8', envKey: 'ANTHROPIC_API_KEY' },
]

/** Vision-capable providers offered in settings, in display/cost order. */
export const VISION_PROVIDERS = VISION_CANDIDATES.map(c => c.provider)

/** Default model for a vision provider when the user leaves the override blank. */
export function defaultVisionModel(provider: string): string | undefined {
  return VISION_CANDIDATES.find(c => c.provider === provider)?.model
}

export interface ResolveVisionOptions {
  /** The athlete's configured vision provider, if any. */
  provider?: string | null
  /** The athlete's vision model override, if any. */
  model?: string | null
}

/**
 * Resolve the dedicated vision provider+model for an image parse. Independent of
 * the athlete's general LLM provider. A per-user selection (opts) wins; otherwise
 * falls back to the env override then key-based candidate order.
 */
export function resolveVisionModel(opts: ResolveVisionOptions = {}): VisionTarget {
  if (opts.provider) {
    const model = opts.model || defaultVisionModel(opts.provider)
    if (!model) {
      throw new VisionUnavailableError(
        `No vision model configured for provider "${opts.provider}". Set a model override in Settings.`,
      )
    }
    return { provider: opts.provider, model }
  }

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
