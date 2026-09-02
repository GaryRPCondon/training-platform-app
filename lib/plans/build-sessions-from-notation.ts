/**
 * Build structured workouts for template Q-slots that a plan never generated.
 *
 * Race-aligning an existing plan (see app/api/dev/realign-plan-weeks) moves each
 * week onto the template row that is N weeks from the race. Most target rows
 * already exist somewhere in the plan and can simply be copied, but a plan that
 * was front-anchored never generated the template's final rows at all — and there
 * is no parser anywhere in this codebase that can turn "8E + 4 × (4 min I w/3 min
 * recovery jg) + 3E" into intervals. Those have to be built by a model.
 *
 * This module owns the prompt and the parse; the caller owns the LLM call and the
 * write, so it stays testable without a provider. The contract handed to the model
 * is `buildStructuredWorkoutContract()` — the same text plan generation uses — so
 * what comes back matches what the parser, distance math, Garmin mapper and role
 * validation expect.
 */

import type { FullTemplate } from '@/lib/templates/types'
import type { ToolDefinition } from '@/lib/agent/provider-interface'
import type { TrainingPaces } from '@/lib/training/vdot'
import { buildStructuredWorkoutContract } from './llm-prompts'
import { buildStructuredWorkout, VALID_ROLES } from './structured-workout-builder'
import {
  calculateTotalWorkoutDistance,
  isTimePrescribedWorkout,
  totalPrescribedSeconds,
} from '@/lib/training/vdot'

/** A Q-slot to build, described entirely by template fields. */
export interface NotationSession {
  /** Caller's handle for this slot — echoed back on the built session. */
  key: string
  /** The template's verbatim Q string, e.g. "8E + 4 × (4 min I w/3 min recovery jg) + 3E". */
  prescription: string
  workout_type: string
  /** Template's own distance for the slot. Used as the fidelity check. */
  km: number
  mileage?: number
  warmup_cooldown?: 'included' | 'add'
  is_session?: boolean
}

export interface BuiltSession {
  key: string
  description: string
  intensity: string
  pace_guidance: string | null
  structured_workout: Record<string, unknown>
  distance_target_meters: number
  /** null clears it, undefined leaves whatever the plan already has. */
  duration_target_seconds: number | null | undefined
}

/** Distance may drift this far from the template's own figure before we reject it. */
const DISTANCE_TOLERANCE = 0.15

/**
 * A plain steady run has no session structure — its prescription is a duration or a
 * duration range, and the template already states the distance that implies. Build
 * it here rather than asking a model: given "steady E run of 120-150 min" one read
 * the bottom of the range and came back 16% under the template's own figure.
 */
export function buildPlainSteadyRun(session: NotationSession): BuiltSession {
  const meters = Math.round(session.km * 1000)
  return {
    key: session.key,
    description: session.prescription,
    intensity: 'easy',
    pace_guidance: null,
    structured_workout: buildStructuredWorkout({
      type: session.workout_type,
      intensity: 'easy',
      structured_workout: {
        main_set: [{ repeat: 1, intervals: [{ distance_meters: meters, intensity: 'easy' }] }],
      },
    }),
    distance_target_meters: meters,
    duration_target_seconds: undefined,
  }
}

/**
 * Re-ask for the sessions whose structure was rejected, quoting what they summed to.
 * The observed failure is always the same: the easy volume embedded in the
 * prescription gets dropped and only the reps are built.
 */
export function buildRetryUserMessage(
  sessions: NotationSession[],
  failures: Array<{ key: string; builtMeters: number }>
): string {
  const byKey = new Map(sessions.map(s => [s.key, s]))
  const lines = failures.flatMap(f => {
    const s = byKey.get(f.key)
    if (!s) return []
    return [
      `- key: ${s.key}\n  prescription: "${s.prescription}"\n` +
      `  your structure summed to ${(f.builtMeters / 1000).toFixed(1)} km; it must total ${s.km} km.\n` +
      `  You dropped easy running that is part of the prescription. EVERY segment counts toward the total — ` +
      `the leading and trailing easy miles, and any "N min E" block — not just the reps.`,
    ]
  })
  return `These sessions were rejected. Rebuild them, accounting for the FULL distance of each prescription:\n\n${lines.join('\n\n')}`
}

export function buildNotationSystemPrompt(template: FullTemplate): string {
  const notation = template.workout_notation
    ? `\nWORKOUT NOTATION (from the template):\n${Object.entries(template.workout_notation)
        .map(([k, v]) => `- ${k}: ${v}`)
        .join('\n')}\n`
    : ''
  const paces = template.pace_targets
    ? `\nPACE KEYS (use these as the "intensity" on interval steps):\n${Object.keys(template.pace_targets)
        .map(k => `- ${k}`)
        .join('\n')}\n`
    : ''

  return `You emit machine-readable workout data. You are not writing advice for a human to read.

Call the ${EMIT_TOOL_NAME} function exactly once with one entry per session you are given, copying each key verbatim. Never describe a workout in prose, never explain effort levels, never mention warm-up routines or stretching — the only output is the function call's structured data.

You are NOT designing training. Each prescription is fixed — reproduce exactly what it says, no more and no less. Do not substitute sessions, adjust volume, or "improve" anything.
${notation}${paces}
DISTANCE FIDELITY:
Each session states the template's own total distance. Its structured_workout must sum to that distance — the system computes the sum by walking warmup + main_set + cooldown. Where the notation is time-based, use duration_seconds and the distance is derived from the athlete's paces.

${buildStructuredWorkoutContract()}`
}

/** Name of the single function the model is forced to call. */
export const EMIT_TOOL_NAME = 'emit_structured_sessions'

/** Warmup/cooldown steps carry duration_minutes rather than a repeat group. */
const EDGE_STEP_SCHEMA = {
  type: 'object',
  description: 'A single continuous easy segment. Only when the prescription adds a separate warm-up/cool-down.',
  properties: {
    duration_minutes: { type: 'number' },
    distance_meters: { type: 'number' },
    intensity: { type: 'string' },
  },
} as const

/**
 * Schema-enforced output. Free-form "return JSON only" instructions were not
 * enough: Gemini answered a 7-session request with a markdown coaching document
 * (effort-level definitions, "Warm-up: light dynamic stretches") and truncated
 * partway through. Forcing a single named tool routes Gemini through its
 * structured-output mode, where the schema makes prose impossible.
 *
 * Every level of `structured_workout` must be declared. Gemini emits exactly what
 * the schema describes and nothing more, so a bare `{ type: 'object' }` here came
 * back as `{}` for all seven sessions — under schema-enforced output an undeclared
 * property is an impossible one, the opposite of free-form prompting.
 */
export function buildEmitSessionsTool(): ToolDefinition {
  return {
    name: EMIT_TOOL_NAME,
    description: 'Emit the structured workout data for every session requested. Call once, with all sessions.',
    parameters: {
      type: 'object',
      properties: {
        sessions: {
          type: 'array',
          description: 'One entry per requested session, in the order given.',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string', description: 'The key given for this session, copied verbatim.' },
              description: { type: 'string', description: 'Short label, e.g. "Q2: 8E + 4 x (4 min I w/3 min recovery jg) + 3E".' },
              intensity: { type: 'string', description: 'Dominant intensity: easy, marathon, tempo, interval or repetition.' },
              pace_guidance: { type: 'string', description: 'One short sentence on how to run it.' },
              structured_workout: {
                type: 'object',
                description: 'The session structure. Omit warmup/cooldown when the prescription embeds its easy bookends in main_set (W/C: included).',
                properties: {
                  warmup: EDGE_STEP_SCHEMA,
                  main_set: {
                    type: 'array',
                    description: 'Repeat groups in order. Never empty.',
                    items: {
                      type: 'object',
                      properties: {
                        repeat: { type: 'number', description: 'Times this group repeats; 1 for a single continuous segment.' },
                        intervals: {
                          type: 'array',
                          description: 'The steps inside one repetition of this group.',
                          items: {
                            type: 'object',
                            properties: {
                              distance_meters: { type: 'number', description: 'Metres. 1 mi = 1609, 1 km = 1000. Use for distance-prescribed steps.' },
                              duration_seconds: { type: 'number', description: 'Seconds. Use for time-prescribed steps. Never mix with distance_meters in the same main_set.' },
                              intensity: { type: 'string', description: 'Pace key, e.g. easy, marathon, threshold, interval, repetition, recovery, rest.' },
                              role: { type: 'string', enum: [...VALID_ROLES], description: 'Function of the step, independent of intensity.' },
                            },
                            required: ['intensity'],
                          },
                        },
                      },
                      required: ['repeat', 'intervals'],
                    },
                  },
                  cooldown: EDGE_STEP_SCHEMA,
                },
                required: ['main_set'],
              },
            },
            required: ['key', 'description', 'intensity', 'structured_workout'],
          },
        },
      },
      required: ['sessions'],
    },
  }
}

export function buildNotationUserMessage(sessions: NotationSession[]): string {
  const lines = sessions.map(s => {
    const wc = s.warmup_cooldown ? ` [W/C: ${s.warmup_cooldown}]` : ''
    const session = s.is_session === false ? ' [plain steady run — a single easy effort, not a session]' : ''
    const dist = s.mileage !== undefined ? `${s.mileage} mi. (${s.km} km)` : `${s.km} km`
    return `- key: ${s.key}\n  type: ${s.workout_type}${wc}${session}\n  total distance: ${dist}\n  prescription: "${s.prescription}"`
  })
  return `Build a structured workout for each of these ${sessions.length} sessions:\n\n${lines.join('\n\n')}`
}

/** Pull the outermost JSON object out of a model response without regex. */
function extractJsonObject(raw: string): string {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('No JSON object found in response')
  return raw.slice(start, end + 1)
}

export interface ParseResult {
  built: BuiltSession[]
  errors: string[]
  /** Sessions whose structure was measured but missed the template distance. */
  rejected?: Array<{ key: string; builtMeters: number }>
  /** Set only when the response could not be read at all, so the caller can show it. */
  rawResponse?: string
}

/**
 * Normalise and check what the model returned. Every session is verified against
 * the template's own distance before it is handed back — a session that drifts is
 * reported, never written.
 */
export function parseBuiltSessions(
  /** The forced tool call's arguments, or raw text when the model answered without it. */
  raw: unknown,
  requested: NotationSession[],
  paces: TrainingPaces | null
): ParseResult {
  const errors: string[] = []
  let parsed: { sessions?: unknown }
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(extractJsonObject(raw)) as { sessions?: unknown }
    } catch (e) {
      return {
        built: [],
        errors: [`Could not parse response: ${e instanceof Error ? e.message : 'invalid JSON'}`],
        rawResponse: raw,
      }
    }
  } else if (raw && typeof raw === 'object') {
    parsed = raw as { sessions?: unknown }
  } else {
    return { built: [], errors: ['Empty response'], rawResponse: String(raw) }
  }
  if (!Array.isArray(parsed.sessions)) {
    return {
      built: [],
      errors: ['Response has no "sessions" array'],
      rawResponse: typeof raw === 'string' ? raw : JSON.stringify(raw),
    }
  }

  const byKey = new Map(
    (parsed.sessions as Array<Record<string, unknown>>)
      .filter(s => typeof s.key === 'string')
      .map(s => [s.key as string, s])
  )

  const built: BuiltSession[] = []
  const rejected: Array<{ key: string; builtMeters: number }> = []
  for (const want of requested) {
    const got = byKey.get(want.key)
    if (!got) {
      errors.push(`${want.key}: no session returned`)
      continue
    }

    const structured = buildStructuredWorkout({
      type: want.workout_type,
      intensity: typeof got.intensity === 'string' ? got.intensity : 'easy',
      pace_guidance: typeof got.pace_guidance === 'string' ? got.pace_guidance : null,
      structured_workout: (got.structured_workout ?? null) as Record<string, unknown> | null,
    })

    const mainSet = structured.main_set
    if (!Array.isArray(mainSet) || mainSet.length === 0) {
      errors.push(`${want.key}: structured_workout has no main_set`)
      continue
    }

    const meters = calculateTotalWorkoutDistance(null, want.workout_type, structured, paces)
    const expected = want.km * 1000
    if (meters <= 0) {
      errors.push(`${want.key}: structured_workout has no measurable distance`)
      continue
    }
    const drift = Math.abs(meters - expected) / expected
    if (drift > DISTANCE_TOLERANCE) {
      errors.push(
        `${want.key}: built ${(meters / 1000).toFixed(1)}km vs template ${want.km}km ` +
        `(${(drift * 100).toFixed(0)}% off, limit ${DISTANCE_TOLERANCE * 100}%)`
      )
      rejected.push({ key: want.key, builtMeters: meters })
      continue
    }

    const seconds = isTimePrescribedWorkout(structured) ? totalPrescribedSeconds(structured) : 0
    built.push({
      key: want.key,
      description: typeof got.description === 'string' && got.description.length > 0
        ? got.description
        : want.prescription,
      intensity: typeof got.intensity === 'string' ? got.intensity : 'easy',
      pace_guidance: typeof got.pace_guidance === 'string' ? got.pace_guidance : null,
      structured_workout: structured,
      distance_target_meters: Math.round(meters),
      duration_target_seconds: seconds > 0 ? seconds : null,
    })
  }

  return { built, errors, rejected }
}
