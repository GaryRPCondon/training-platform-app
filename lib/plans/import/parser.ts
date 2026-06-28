import { createLLMProvider } from '@/lib/agent/factory'
import { writeLLMLog } from '@/lib/agent/llm-logger'
import {
  parseLLMResultSchema,
  ParsedRunningPlan,
} from '@/lib/plans/import/schemas'
import { RUN_PLAN_PARSER_SYSTEM_PROMPT } from '@/lib/plans/import/prompts'
import { normalizeParsedPlan } from '@/lib/plans/import/normalize'

export interface ParseRunningPlanInput {
  /** 'free_text' | 'json' for the text path. (Image path handled in Phase 2.) */
  source_type: 'free_text' | 'json'
  text: string
  providerName?: string
  modelName?: string
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
  const provider = createLLMProvider(input.providerName, input.modelName)

  const userMessage =
    input.source_type === 'json'
      ? `The following is a running plan in JSON format. Parse and normalise it into the output contract.\n\n\`\`\`json\n${input.text}\n\`\`\``
      : `Parse the following running plan into the output contract.\n\n${input.text}`

  const response = await provider.generateResponse({
    messages: [{ role: 'user', content: userMessage }],
    systemPrompt: RUN_PLAN_PARSER_SYSTEM_PROMPT,
    maxTokens: PARSE_MAX_TOKENS,
    temperature: 0.1,
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
    inputLength: input.text.length,
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
