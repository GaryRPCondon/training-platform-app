import { createLLMProvider } from '@/lib/agent/factory'
import { writeLLMLog } from '@/lib/agent/llm-logger'
import { parseLLMResultSchema, ParseLLMResult, ParsedProgram } from '@/lib/strength/schemas'
import { STRENGTH_PARSER_SYSTEM_PROMPT } from '@/lib/strength/prompts'
import { buildCatalogLookup, resolveExerciseAgainstCatalog } from '@/lib/strength/exercise-mapper'
import { StrengthExerciseCatalog } from '@/types/database'

export interface ParseInput {
  text: string
  source_format: 'free_text' | 'json'
  providerName?: string
  modelName?: string
  catalog: StrengthExerciseCatalog[]
}

export interface ParseOutput {
  program: ParsedProgram
  confidence: number
  contentType: 'strength' | 'mobility' | 'mixed' | 'other'
  warnings: string[]
  model: string
  inputTokens: number
  outputTokens: number
}

/**
 * Parse a free-text or JSON strength program into a validated ParsedProgram.
 *
 * For 'json' source_format, we still hand the input to the LLM rather than
 * shortcutting straight to Zod — this lets the same prompt normalise field
 * names ("rest" vs "rest_seconds"), enforce canonical exercise names, and
 * stamp the parse metadata uniformly.
 */
// A full multi-week program runs to 150+ exercises, each emitting a fat JSON
// object (canonical/display/user_text + measurement + garmin suggestion
// fields), so an 8-week plan needs ~16-18k output tokens; the old 4000/16000
// caps truncated mid-stream → invalid JSON. 32000 covers a ~12-wk/36-session
// plan with headroom and sits within every current provider's output ceiling
// (Gemini flash/flash-lite 65536, DeepSeek-v4-flash 384k, etc.). You are only
// billed for tokens actually generated, so the high cap is free on small plans.
const PARSE_MAX_TOKENS = 32000

export async function parseStrengthProgram(input: ParseInput): Promise<ParseOutput> {
  const provider = createLLMProvider(input.providerName, input.modelName)

  const userMessage = input.source_format === 'json'
    ? `The following is a strength program in JSON format. Parse and normalise it into the output contract.\n\n\`\`\`json\n${input.text}\n\`\`\``
    : `Parse the following strength/mobility program into the output contract.\n\n${input.text}`

  const response = await provider.generateResponse({
    messages: [{ role: 'user', content: userMessage }],
    systemPrompt: STRENGTH_PARSER_SYSTEM_PROMPT,
    maxTokens: PARSE_MAX_TOKENS,
    temperature: 0.1,
  })

  let raw: unknown
  try {
    raw = JSON.parse(stripCodeFence(response.content))
  } catch (err) {
    writeLLMLog('strength-parse-error', {
      stage: 'json_parse',
      error: err instanceof Error ? err.message : String(err),
      response: response.content,
    })
    throw new ParseFailedError('LLM returned invalid JSON', { responseText: response.content })
  }

  const validated = parseLLMResultSchema.safeParse(raw)
  if (!validated.success) {
    writeLLMLog('strength-parse-error', {
      stage: 'zod_validate',
      issues: validated.error.flatten(),
      response: raw,
    })
    throw new ParseFailedError('LLM output did not match expected schema', {
      issues: validated.error.flatten(),
      rawResponse: raw,
    })
  }

  // Deterministic catalog enrichment — always overrides whatever the LLM put
  // in `garmin_supported`. The LLM is prompted to set it to false; we set the
  // true authoritative value here.
  const lookup = buildCatalogLookup(input.catalog)
  const result: ParseLLMResult = validated.data
  const enrichedProgram: ParsedProgram = {
    ...result.program,
    // Re-sequence session_index deterministically (1..N in emit order). The
    // contract is "1-based, sequential, no gaps" but the LLM occasionally
    // duplicates or skips an index on long plans — which then collides as a
    // React key in the review UI and corrupts scheduling (the engine groups
    // and places sessions by session_index). We own the index, not the LLM.
    sessions: result.program.sessions.map((session, i) => ({
      ...session,
      session_index: i + 1,
      exercises: session.exercises.map(ex => resolveExerciseAgainstCatalog(ex, lookup)),
    })),
  }

  writeLLMLog('strength-parse', {
    sourceFormat: input.source_format,
    inputLength: input.text.length,
    model: response.model,
    confidence: result.confidence,
    contentType: result.content_type,
    warnings: result.warnings,
    sessionsCount: enrichedProgram.sessions.length,
  })

  return {
    program: enrichedProgram,
    confidence: result.confidence,
    contentType: result.content_type,
    warnings: result.warnings,
    model: response.model,
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
  }
}

export class ParseFailedError extends Error {
  details: Record<string, unknown>
  constructor(message: string, details: Record<string, unknown>) {
    super(message)
    this.name = 'ParseFailedError'
    this.details = details
  }
}

function stripCodeFence(text: string): string {
  let t = text.trim()
  if (!t.startsWith('```')) return t
  // Drop opening fence (with optional language tag) up to the first newline.
  const firstNewline = t.indexOf('\n')
  if (firstNewline === -1) return t
  t = t.slice(firstNewline + 1)
  // Drop trailing fence if present.
  if (t.endsWith('```')) t = t.slice(0, -3)
  return t.trim()
}
