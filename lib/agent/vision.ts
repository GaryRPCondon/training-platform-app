/**
 * Vision routing for multimodal imports.
 *
 * Most providers offer a vision-capable model, but the user's *text* default
 * (e.g. deepseek-reasoner) often isn't one. For image imports we resolve to a
 * vision-capable model — preferring the user's own provider so they stay on
 * their configured/billed account, falling back to Gemini otherwise.
 *
 * NB: exact vision model ids drift between providers — verify against each
 * provider's current catalog at build/deploy time. Both the provider and the
 * model can be overridden with env vars without a code change (handy when a
 * provider ships a new vision model or DeepSeek-VL's id changes):
 *   IMPORT_VISION_PROVIDER, IMPORT_VISION_MODEL
 */

// Per-provider vision-capable model. Update as provider catalogs change.
const VISION_MODEL_BY_PROVIDER: Record<string, string> = {
  anthropic: 'claude-sonnet-4-5-20250929',
  openai: 'gpt-4o',
  gemini: 'gemini-2.5-flash',
  // DeepSeek-VL is OpenAI-compatible via /chat/completions; id needs verifying.
  deepseek: 'deepseek-vl',
  grok: 'grok-2-vision-1212',
}

const DEFAULT_VISION_PROVIDER = 'gemini'

export function providerSupportsVision(provider: string | null | undefined): boolean {
  return !!provider && provider in VISION_MODEL_BY_PROVIDER
}

export interface VisionTarget {
  provider: string
  model: string
}

/**
 * Resolve the provider+model to use for an image parse. Prefers the user's
 * provider when it has a known vision model; otherwise falls back to Gemini.
 * Env overrides win outright.
 */
export function resolveVisionModel(preferredProvider: string | null | undefined): VisionTarget {
  const envProvider = process.env.IMPORT_VISION_PROVIDER
  const envModel = process.env.IMPORT_VISION_MODEL
  if (envProvider && envModel) {
    return { provider: envProvider, model: envModel }
  }

  if (providerSupportsVision(preferredProvider)) {
    return { provider: preferredProvider!, model: VISION_MODEL_BY_PROVIDER[preferredProvider!] }
  }
  return { provider: DEFAULT_VISION_PROVIDER, model: VISION_MODEL_BY_PROVIDER[DEFAULT_VISION_PROVIDER] }
}
