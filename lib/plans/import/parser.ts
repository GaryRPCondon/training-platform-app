import { createLLMProvider } from '@/lib/agent/factory'
import { writeLLMLog } from '@/lib/agent/llm-logger'
import {
  parseLLMResultSchema,
  ParsedRunningPlan,
} from '@/lib/plans/import/schemas'
import { RUN_PLAN_PARSER_SYSTEM_PROMPT, RUN_PLAN_VISION_SYSTEM_PROMPT } from '@/lib/plans/import/prompts'
import { normalizeParsedPlan } from '@/lib/plans/import/normalize'
import { resolveVisionModel } from '@/lib/agent/vision'
import type { MessageContent } from '@/lib/agent/provider-interface'

export interface ParseImage {
  mimeType: string
  dataBase64: string
}

export interface ParseRunningPlanInput {
  source_type: 'free_text' | 'json' | 'image'
  /** Required for free_text/json. */
  text?: string
  /** Required for image. One or more pages of a single plan, in order. */
  images?: ParseImage[]
  providerName?: string
  modelName?: string
  /** Image-only: the athlete's configured vision provider/model override. */
  visionProvider?: string
  visionModel?: string
}

export interface ParseRunningPlanOutput {
  plan: ParsedRunningPlan
  confidence: number
  contentType: 'running' | 'other'
  warnings: string[]
  totalWeeks: number
  model: string
  inputTokens: number
  outputTokens: number
}

// A full marathon plan (18 weeks × 7 days, several with structured intervals)
// is large. Mirror the strength parser's generous cap — billed only for tokens
// actually generated, so this is free on short plans and prevents mid-stream
// truncation on long ones.
const PARSE_MAX_TOKENS = 32000

/**
 * Parse a free-text or JSON running plan into a normalized ParsedRunningPlan.
 *
 * For 'json' we still route through the LLM (rather than straight to Zod) so the
 * same contract normalises field names, reverses "weeks to goal" ordering, and
 * maps intensities uniformly.
 */
export async function parseRunningPlan(
  input: ParseRunningPlanInput,
): Promise<ParseRunningPlanOutput> {
  const isImage = input.source_type === 'image'

  // Image imports route to a vision-capable model (the user's text default may
  // not be one); text/json use the configured provider/model.
  // Vision is decoupled from the user's general provider — always its own
  // dedicated vision model (per-user setting, then env/key fallback).
  const vision = isImage
    ? resolveVisionModel({ provider: input.visionProvider, model: input.visionModel })
    : null
  const provider = vision
    ? createLLMProvider(vision.provider, vision.model)
    : createLLMProvider(input.providerName, input.modelName)

  let content: MessageContent
  if (isImage) {
    if (!input.images || input.images.length === 0) {
      throw new RunPlanParseError('No images supplied for image import', {})
    }
    content = [
      { type: 'text', text: 'Parse this running plan from the image(s) into the output contract. The pages are in order.' },
      ...input.images.map(img => ({ type: 'image' as const, mimeType: img.mimeType, dataBase64: img.dataBase64 })),
    ]
  } else if (input.source_type === 'json') {
    content = `The following is a running plan in JSON format. Parse and normalise it into the output contract.\n\n\`\`\`json\n${input.text}\n\`\`\``
  } else {
    content = `Parse the following running plan into the output contract.\n\n${input.text}`
  }

  const response = await provider.generateResponse({
    messages: [{ role: 'user', content }],
    systemPrompt: isImage ? RUN_PLAN_VISION_SYSTEM_PROMPT : RUN_PLAN_PARSER_SYSTEM_PROMPT,
    maxTokens: PARSE_MAX_TOKENS,
    temperature: 0.1,
    // Extraction only — keep the whole output budget for JSON, no thinking.
    disableThinking: true,
  })

  let raw: unknown
  try {
    raw = JSON.parse(stripCodeFence(response.content))
  } catch (err) {
    writeLLMLog('run-plan-parse-error', {
      stage: 'json_parse',
      error: err instanceof Error ? err.message : String(err),
      response: response.content,
    })
    throw new RunPlanParseError('LLM returned invalid JSON', {
      responseText: response.content,
    })
  }

  const validated = parseLLMResultSchema.safeParse(raw)
  if (!validated.success) {
    writeLLMLog('run-plan-parse-error', {
      stage: 'zod_validate',
      issues: validated.error.flatten(),
      response: raw,
    })
    throw new RunPlanParseError('LLM output did not match expected schema', {
      issues: validated.error.flatten(),
      rawResponse: raw,
    })
  }

  const { plan: normalized, totalWeeks } = normalizeParsedPlan(validated.data.plan)

  writeLLMLog('run-plan-parse', {
    sourceType: input.source_type,
    inputLength: input.text?.length ?? 0,
    imageCount: input.images?.length ?? 0,
    model: response.model,
    confidence: validated.data.confidence,
    contentType: validated.data.content_type,
    totalWeeks,
    warnings: validated.data.warnings,
  })

  return {
    plan: normalized,
    confidence: validated.data.confidence,
    contentType: validated.data.content_type,
    warnings: validated.data.warnings,
    totalWeeks,
    model: response.model,
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
  }
}

export class RunPlanParseError extends Error {
  details: Record<string, unknown>
  constructor(message: string, details: Record<string, unknown>) {
    super(message)
    this.name = 'RunPlanParseError'
    this.details = details
  }
}

function stripCodeFence(text: string): string {
  let t = text.trim()
  if (!t.startsWith('```')) return t
  const firstNewline = t.indexOf('\n')
  if (firstNewline === -1) return t
  t = t.slice(firstNewline + 1)
  if (t.endsWith('```')) t = t.slice(0, -3)
  return t.trim()
}
