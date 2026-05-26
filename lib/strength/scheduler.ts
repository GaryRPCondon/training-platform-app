import { createLLMProvider } from '@/lib/agent/factory'
import { writeLLMLog } from '@/lib/agent/llm-logger'
import { PLACE_STRENGTH_SESSIONS_TOOL } from '@/lib/strength/tools'
import { STRENGTH_SCHEDULER_SYSTEM_PROMPT } from '@/lib/strength/scheduling-prompts'
import { ParsedProgram, ParsedSession } from '@/lib/strength/schemas'
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
  session_index: number      // 1..N for fixed; 1..(N*weeks) for weekly
  scheduled_date: string
  placement_rationale: string
}

export type ProgramType = 'fixed' | 'weekly'

export interface ScheduleInput {
  parsedProgram: ParsedProgram
  startDate: string         // YYYY-MM-DD
  programType: ProgramType
  weeksToRepeat?: number    // required when programType === 'weekly'
  plannedWorkouts: PlannedWorkoutSummary[]
  providerName?: string
  modelName?: string
}

// ---------------------------------------------------------------------------
// Pure expansion + date math — deterministic candidate generation
// ---------------------------------------------------------------------------

// Default spacing for 'fixed' mode when sessions don't carry their own
// preferred-day hints. The LLM can shift ±7 days per session to avoid
// running-quality conflicts.
const FIXED_MODE_DEFAULT_SPACING_DAYS = 3

/**
 * Expand a parsed program's template sessions into the full list of sessions
 * the scheduler will place. For 'fixed' mode this is the original list. For
 * 'weekly' mode the template sessions are replicated `weeksToRepeat` times
 * with monotonically increasing session_index values.
 *
 * The returned indices align 1:1 with `generateCandidateDates` below.
 */
export function expandSessionsForScheduling(
  parsedSessions: ParsedSession[],
  programType: ProgramType,
  weeksToRepeat?: number,
): ParsedSession[] {
  if (programType === 'fixed') return parsedSessions
  if (!weeksToRepeat || weeksToRepeat < 1) {
    throw new Error('weeksToRepeat is required for weekly programs')
  }
  const out: ParsedSession[] = []
  const n = parsedSessions.length
  for (let week = 0; week < weeksToRepeat; week++) {
    for (const s of parsedSessions) {
      out.push({ ...s, session_index: week * n + s.session_index })
    }
  }
  return out
}

/**
 * Deterministic candidate dates for the scheduler — one per expanded session.
 *
 * Fixed mode: sequential days spaced by FIXED_MODE_DEFAULT_SPACING_DAYS.
 * Weekly mode: spread `sessionsPerWeek` evenly across each 7-day window for
 *   `weeksToRepeat` weeks. Spacing within a week = floor(7 / sessionsPerWeek)
 *   so 2/week → ~Mon/Thu, 3/week → ~Mon/Wed/Fri.
 *
 * The LLM may shift any candidate ±7 days to avoid running conflicts.
 */
export function generateCandidateDates(
  startDate: string,
  programType: ProgramType,
  sessionsPerWeek: number,
  weeksToRepeat?: number,
): string[] {
  if (sessionsPerWeek < 1) return []

  if (programType === 'fixed') {
    return Array.from({ length: sessionsPerWeek }, (_, i) =>
      addDaysISO(startDate, i * FIXED_MODE_DEFAULT_SPACING_DAYS),
    )
  }

  const weeks = weeksToRepeat ?? 0
  if (weeks < 1) throw new Error('weeksToRepeat is required for weekly programs')
  const spacing = Math.max(1, Math.floor(7 / sessionsPerWeek))
  const out: string[] = []
  for (let week = 0; week < weeks; week++) {
    for (let k = 0; k < sessionsPerWeek; k++) {
      out.push(addDaysISO(startDate, week * 7 + k * spacing))
    }
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

function addDaysISO(s: string, n: number): string {
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
  const templateSessions = input.parsedProgram.sessions
  const expandedSessions = expandSessionsForScheduling(
    templateSessions,
    input.programType,
    input.weeksToRepeat,
  )
  const candidates = generateCandidateDates(
    input.startDate,
    input.programType,
    templateSessions.length,
    input.weeksToRepeat,
  )

  if (expandedSessions.length !== candidates.length) {
    throw new SchedulingFailedError(
      `Internal: expanded sessions (${expandedSessions.length}) and candidates (${candidates.length}) mismatched`,
      { templateCount: templateSessions.length, weeksToRepeat: input.weeksToRepeat },
    )
  }

  const windowStart = addDaysISO(candidates[0]!, -7)
  const windowEnd = addDaysISO(candidates[candidates.length - 1]!, 7)
  const workoutsInWindow = input.plannedWorkouts.filter(
    w => w.scheduled_date >= windowStart && w.scheduled_date <= windowEnd,
  )

  const userMessage = JSON.stringify({
    program_type: input.programType,
    weeks_to_repeat: input.weeksToRepeat ?? null,
    sessions: expandedSessions.map(s => ({
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
    maxTokens: 8000,
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

  const placements = enforceConstraints(
    validated.data.placements,
    expandedSessions.length,
    windowStart,
    windowEnd,
  )

  writeLLMLog('strength-schedule', {
    model: response.model,
    startDate: input.startDate,
    programType: input.programType,
    weeksToRepeat: input.weeksToRepeat ?? null,
    templateSessionsCount: templateSessions.length,
    expandedSessionsCount: expandedSessions.length,
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
