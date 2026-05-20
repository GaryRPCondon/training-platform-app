import { createLLMProvider } from '@/lib/agent/factory'
import { writeLLMLog } from '@/lib/agent/llm-logger'
import { PLACE_STRENGTH_SESSIONS_TOOL } from '@/lib/strength/tools'
import { STRENGTH_SCHEDULER_SYSTEM_PROMPT } from '@/lib/strength/scheduling-prompts'
import { ParsedProgram } from '@/lib/strength/schemas'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlannedWorkoutSummary {
  scheduled_date: string  // YYYY-MM-DD
  workout_type: string
  description: string | null
}

export interface Placement {
  session_index: number
  scheduled_date: string
  placement_rationale: string
}

export interface ScheduleInput {
  parsedProgram: ParsedProgram
  startDate: string         // YYYY-MM-DD
  cadenceDays: number       // 1..7
  plannedWorkouts: PlannedWorkoutSummary[]
  providerName?: string
  modelName?: string
}

// ---------------------------------------------------------------------------
// Pure date math — deterministic candidate generation
// ---------------------------------------------------------------------------

export function generateCandidateDates(
  startDate: string,
  cadenceDays: number,
  sessionCount: number,
): string[] {
  if (cadenceDays < 1) throw new Error('cadenceDays must be >= 1')
  if (sessionCount < 1) return []
  const start = parseISODate(startDate)
  const out: string[] = []
  for (let i = 0; i < sessionCount; i++) {
    const d = new Date(start)
    d.setUTCDate(d.getUTCDate() + i * cadenceDays)
    out.push(toISODate(d))
  }
  return out
}

function parseISODate(s: string): Date {
  // Anchor in UTC so day math doesn't get bitten by DST or local TZ.
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function toISODate(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addDays(s: string, n: number): string {
  const d = parseISODate(s)
  d.setUTCDate(d.getUTCDate() + n)
  return toISODate(d)
}

// ---------------------------------------------------------------------------
// LLM placement
// ---------------------------------------------------------------------------

const placementSchema = z.object({
  session_index: z.number().int().min(1),
  scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  placement_rationale: z.string().min(1).max(500),
})

const toolResponseSchema = z.object({
  placements: z.array(placementSchema).min(1),
})

export async function placeSessionsWithLLM(input: ScheduleInput): Promise<Placement[]> {
  const sessions = input.parsedProgram.sessions
  const candidates = generateCandidateDates(input.startDate, input.cadenceDays, sessions.length)

  const windowStart = addDays(candidates[0]!, -7)
  const windowEnd = addDays(candidates[candidates.length - 1]!, 7)
  const workoutsInWindow = input.plannedWorkouts.filter(
    w => w.scheduled_date >= windowStart && w.scheduled_date <= windowEnd,
  )

  const userMessage = JSON.stringify({
    cadence_days: input.cadenceDays,
    sessions: sessions.map(s => ({
      session_index: s.session_index,
      title: s.title,
      estimated_duration_minutes: s.estimated_duration_minutes ?? null,
      exercise_count: s.exercises.length,
      sample_exercises: s.exercises.slice(0, 4).map(e => e.display_name),
    })),
    candidate_dates: candidates,
    window: { start: windowStart, end: windowEnd },
    planned_workouts: workoutsInWindow,
  })

  const provider = createLLMProvider(input.providerName, input.modelName)
  const response = await provider.generateResponse({
    messages: [{ role: 'user', content: userMessage }],
    systemPrompt: STRENGTH_SCHEDULER_SYSTEM_PROMPT,
    tools: [PLACE_STRENGTH_SESSIONS_TOOL],
    toolChoice: { type: 'function', function: { name: PLACE_STRENGTH_SESSIONS_TOOL.name } },
    maxTokens: 2000,
    temperature: 0.1,
  })

  const toolCall = response.toolCalls?.find(tc => tc.name === PLACE_STRENGTH_SESSIONS_TOOL.name)
  if (!toolCall) {
    writeLLMLog('strength-schedule-error', {
      stage: 'no_tool_call',
      response: response.content,
      toolCalls: response.toolCalls,
    })
    throw new SchedulingFailedError('LLM did not call the placement tool', {
      responseText: response.content,
    })
  }

  const validated = toolResponseSchema.safeParse(toolCall.arguments)
  if (!validated.success) {
    writeLLMLog('strength-schedule-error', {
      stage: 'tool_args_validate',
      issues: validated.error.flatten(),
      args: toolCall.arguments,
    })
    throw new SchedulingFailedError('Tool arguments did not match expected shape', {
      issues: validated.error.flatten(),
    })
  }

  const placements = enforceConstraints(validated.data.placements, sessions.length, windowStart, windowEnd)

  writeLLMLog('strength-schedule', {
    model: response.model,
    startDate: input.startDate,
    cadenceDays: input.cadenceDays,
    sessionsCount: sessions.length,
    workoutsInWindow: workoutsInWindow.length,
    placements,
  })

  return placements
}

/**
 * Defensive post-conditions on the LLM output. We don't trust the LLM to
 * preserve order or stay within the window even though the prompt asks it to.
 */
function enforceConstraints(
  placements: Placement[],
  expectedCount: number,
  windowStart: string,
  windowEnd: string,
): Placement[] {
  if (placements.length !== expectedCount) {
    throw new SchedulingFailedError(
      `Expected ${expectedCount} placements but got ${placements.length}`,
      { placements },
    )
  }
  // Sort by session_index and verify it's a complete 1..N sequence.
  const sorted = [...placements].sort((a, b) => a.session_index - b.session_index)
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].session_index !== i + 1) {
      throw new SchedulingFailedError(
        `Placements must have session_index 1..${expectedCount}; got ${sorted.map(p => p.session_index).join(',')}`,
        { placements },
      )
    }
    if (sorted[i].scheduled_date < windowStart || sorted[i].scheduled_date > windowEnd) {
      throw new SchedulingFailedError(
        `Placement for session ${sorted[i].session_index} is outside the allowed window (${windowStart}..${windowEnd})`,
        { placements },
      )
    }
    if (i > 0 && sorted[i].scheduled_date < sorted[i - 1].scheduled_date) {
      throw new SchedulingFailedError(
        `Session ${sorted[i].session_index} is scheduled before session ${sorted[i - 1].session_index}`,
        { placements },
      )
    }
  }
  return sorted
}

export class SchedulingFailedError extends Error {
  details: Record<string, unknown>
  constructor(message: string, details: Record<string, unknown>) {
    super(message)
    this.name = 'SchedulingFailedError'
    this.details = details
  }
}
