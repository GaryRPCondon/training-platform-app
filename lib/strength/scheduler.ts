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
// Deterministic week- and load-aware placement
//
// For a 'fixed' program whose sessions carry week_index, we don't ask the LLM
// to place sessions at all — the policy is well-defined sports science and the
// LLM has proven it won't reliably hold it. Each strength week is anchored to
// its own 7-day window (so the plan never drifts past its intended length),
// the week's running days are classified hard/easy/rest, and sessions are
// assigned by load_category:
//   - mobility_recovery → the rest day (recovery work belongs there)
//   - loaded            → easy days, preferring slots clear of the next hard
//                         run, spaced ≥1 day apart
// Classification of each session (the one genuinely fuzzy judgement) was done
// by the LLM at parse time; here we only apply rules.
// ---------------------------------------------------------------------------

const HARD_RUN_TYPES = new Set(['intervals', 'tempo', 'long_run', 'race', 'quality'])
const EASY_RUN_TYPES = new Set(['easy_run', 'recovery', 'cross_training'])

type DayClass = 'hard' | 'easy' | 'rest'

function classifyDay(workouts: PlannedWorkoutSummary[] | undefined): DayClass {
  if (!workouts || workouts.length === 0) return 'rest'
  if (workouts.some(w => HARD_RUN_TYPES.has(w.workout_type))) return 'hard'
  if (workouts.some(w => EASY_RUN_TYPES.has(w.workout_type))) return 'easy'
  return 'rest' // only 'rest' rows present
}

/**
 * True when every session carries a week_index — the precondition for the
 * deterministic week-aware engine. Free-form / legacy programs that lack it
 * fall back to the LLM placement path.
 */
export function hasWeekStructure(sessions: ParsedSession[]): boolean {
  return sessions.length > 0 && sessions.every(s => s.week_index != null)
}

export function placeStrengthSessionsWeekAware(
  sessions: ParsedSession[],
  startDate: string,
  plannedWorkouts: PlannedWorkoutSummary[],
): Placement[] {
  const byDate = new Map<string, PlannedWorkoutSummary[]>()
  for (const w of plannedWorkouts) {
    const arr = byDate.get(w.scheduled_date)
    if (arr) arr.push(w)
    else byDate.set(w.scheduled_date, [w])
  }

  // Group by week, preserving encounter order within a week.
  const weeks = new Map<number, ParsedSession[]>()
  for (const s of sessions) {
    const wk = s.week_index ?? 1
    const arr = weeks.get(wk)
    if (arr) arr.push(s)
    else weeks.set(wk, [s])
  }
  const weekNumbers = [...weeks.keys()].sort((a, b) => a - b)

  const placements: Placement[] = []
  // Anchor by sequential position (wi), not week number, so a gap in week
  // numbering doesn't open an empty calendar week. Week 1 day 1 == startDate.
  for (let wi = 0; wi < weekNumbers.length; wi++) {
    const weekSessions = weeks
      .get(weekNumbers[wi])!
      .slice()
      .sort((a, b) => (a.day_index ?? a.session_index) - (b.day_index ?? b.session_index))
    const windowStart = addDaysISO(startDate, wi * 7)
    const weekDates = Array.from({ length: 7 }, (_, d) => addDaysISO(windowStart, d))
    const dayClass = new Map<string, DayClass>(
      weekDates.map(d => [d, classifyDay(byDate.get(d))]),
    )
    placements.push(...placeWeek(weekSessions, weekDates, dayClass, byDate))
  }
  return placements
}

function placeWeek(
  weekSessions: ParsedSession[],
  weekDates: string[],
  dayClass: Map<string, DayClass>,
  byDate: Map<string, PlannedWorkoutSummary[]>,
): Placement[] {
  // No running at all this week (e.g. weeks past the end of the run plan):
  // there is no rest-day signal to honour, so just spread evenly and keep the
  // user's day order.
  const hasRuns = weekDates.some(d => (byDate.get(d)?.length ?? 0) > 0)
  if (!hasRuns) return evenlySpacedWeek(weekSessions, weekDates)

  const used = new Set<string>()
  const placed: Array<{ session: ParsedSession; date: string; rationale: string }> = []

  const mobility = weekSessions.filter(s => s.load_category === 'mobility_recovery')
  const loaded = weekSessions.filter(s => s.load_category !== 'mobility_recovery')

  for (const s of mobility) {
    const date = pickMobilityDay(weekDates, dayClass, used)
    used.add(date)
    placed.push({ session: s, date, rationale: mobilityRationale(dayClass.get(date)) })
  }
  for (const s of loaded) {
    const date = pickLoadedDay(weekDates, dayClass, used)
    used.add(date)
    placed.push({ session: s, date, rationale: loadedRationale(date, dayClass) })
  }

  // Order placements by date (intra-week label order is intentionally relaxed so
  // mobility can take the rest day wherever it falls). Inter-week order holds
  // because each week occupies a strictly later 7-day window.
  return placed
    .sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : a.session.session_index - b.session.session_index,
    )
    .map(r => ({
      session_index: r.session.session_index,
      scheduled_date: r.date,
      placement_rationale: r.rationale,
    }))
}

function evenlySpacedWeek(weekSessions: ParsedSession[], weekDates: string[]): Placement[] {
  const n = weekSessions.length
  const spacing = Math.max(1, Math.floor(7 / n))
  return weekSessions.map((s, i) => ({
    session_index: s.session_index,
    scheduled_date: weekDates[Math.min(6, i * spacing)],
    placement_rationale: 'Spaced evenly through the week (no runs scheduled)',
  }))
}

function adjacentToUsed(date: string, used: Set<string>): boolean {
  return used.has(addDaysISO(date, 1)) || used.has(addDaysISO(date, -1))
}

function pickMobilityDay(
  weekDates: string[],
  dayClass: Map<string, DayClass>,
  used: Set<string>,
): string {
  const free = weekDates.filter(d => !used.has(d))
  const rest = free.filter(d => dayClass.get(d) === 'rest')
  if (rest.length) return rest[0]
  const easy = free.filter(d => dayClass.get(d) === 'easy')
  if (easy.length) return easy[0]
  return free[0] ?? weekDates[0]
}

function pickLoadedDay(
  weekDates: string[],
  dayClass: Map<string, DayClass>,
  used: Set<string>,
): string {
  const isProtectedEasy = (d: string) =>
    dayClass.get(d) === 'easy' && dayClass.get(addDaysISO(d, 1)) !== 'hard'

  // Tier 1: easy, clear of the next hard run, spaced from other strength days.
  const spaced = weekDates.filter(d => !used.has(d) && !adjacentToUsed(d, used))
  let tier = spaced.filter(isProtectedEasy)
  if (tier.length) return tier[0]
  // Tier 2: any easy day, still spaced (dense week — every easy day is pre-hard).
  tier = spaced.filter(d => dayClass.get(d) === 'easy')
  if (tier.length) return tier[0]
  // Tier 3: a free rest day, spaced.
  tier = spaced.filter(d => dayClass.get(d) === 'rest')
  if (tier.length) return tier[0]
  // Tier 4: relax spacing — any non-hard unused day.
  const free = weekDates.filter(d => !used.has(d))
  tier = free.filter(d => dayClass.get(d) !== 'hard')
  if (tier.length) return tier[0]
  // Tier 5: nothing left but a hard day — stack it (do strength after the run).
  return free[0] ?? weekDates[0]
}

function mobilityRationale(cls: DayClass | undefined): string {
  if (cls === 'rest') return 'Mobility & recovery on your rest day'
  if (cls === 'easy') return 'Mobility on an easy day (no rest day this week)'
  return 'Mobility & recovery session'
}

function loadedRationale(date: string, dayClass: Map<string, DayClass>): string {
  const cls = dayClass.get(date)
  const next = dayClass.get(addDaysISO(date, 1))
  if (cls === 'easy' && next !== 'hard') return 'Loaded session on an easy day, clear of your next hard run'
  if (cls === 'easy') return 'Loaded session on an easy day (back-to-back hard days this week)'
  if (cls === 'rest') return 'Loaded session on a free day'
  if (cls === 'hard') return 'Loaded session stacked on a hard run day — lift after your run'
  return 'Loaded strength session'
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
