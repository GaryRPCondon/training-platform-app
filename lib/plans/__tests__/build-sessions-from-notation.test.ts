import { describe, it, expect } from 'vitest'
import {
  buildNotationSystemPrompt,
  buildNotationUserMessage,
  parseBuiltSessions,
  buildEmitSessionsTool,
  buildPlainSteadyRun,
  buildRetryUserMessage,
  EMIT_TOOL_NAME,
  type NotationSession,
} from '../build-sessions-from-notation'
import { VALID_ROLES } from '../structured-workout-builder'
import type { FullTemplate } from '@/lib/templates/types'
import type { TrainingPaces } from '@/lib/training/vdot'

const PACES: TrainingPaces = {
  easy: 309, marathon: 256, threshold: 242, interval: 222, repetition: 205,
} as unknown as TrainingPaces

// JD 2Q 41-55 plan_week 17 Q2 — one of the sessions the Dublin plan never generated.
const SESSION: NotationSession = {
  key: '23003',
  prescription: '4E + 1T + 2M + 1E + 1T + 2M + 2E',
  workout_type: 'tempo',
  km: 21,
  mileage: 13,
  warmup_cooldown: 'included',
  is_session: true,
}

/** 21 km split across the prescription's seven segments. */
const GOOD_STRUCTURE = {
  main_set: [
    { repeat: 1, intervals: [{ distance_meters: 6436, intensity: 'easy', role: 'warmup' }] },
    { repeat: 1, intervals: [{ distance_meters: 1609, intensity: 'threshold', role: 'work' }] },
    { repeat: 1, intervals: [{ distance_meters: 3218, intensity: 'marathon', role: 'work' }] },
    { repeat: 1, intervals: [{ distance_meters: 1609, intensity: 'easy', role: 'recovery' }] },
    { repeat: 1, intervals: [{ distance_meters: 1609, intensity: 'threshold', role: 'work' }] },
    { repeat: 1, intervals: [{ distance_meters: 3218, intensity: 'marathon', role: 'work' }] },
    { repeat: 1, intervals: [{ distance_meters: 3218, intensity: 'easy', role: 'cooldown' }] },
  ],
}

const reply = (sessions: unknown[]) => JSON.stringify({ sessions })

describe('parseBuiltSessions', () => {
  it('accepts a session whose structure sums to the template distance', () => {
    const { built, errors } = parseBuiltSessions(
      reply([{ key: '23003', description: 'Q2: 4E + 1T + 2M + 1E + 1T + 2M + 2E', intensity: 'tempo', pace_guidance: 'Hold T on the mile reps.', structured_workout: GOOD_STRUCTURE }]),
      [SESSION], PACES
    )
    expect(errors).toEqual([])
    expect(built).toHaveLength(1)
    expect(built[0].distance_target_meters).toBeGreaterThan(20000)
    expect(built[0].distance_target_meters).toBeLessThan(22000)
    expect(built[0].structured_workout.main_set).toHaveLength(7)
  })

  it('rejects a session whose distance drifts beyond tolerance', () => {
    const short = { main_set: [{ repeat: 1, intervals: [{ distance_meters: 5000, intensity: 'easy' }] }] }
    const { built, errors } = parseBuiltSessions(
      reply([{ key: '23003', description: 'x', intensity: 'tempo', structured_workout: short }]),
      [SESSION], PACES
    )
    expect(built).toEqual([])
    expect(errors[0]).toContain('vs template 21km')
  })

  it('rejects a session with an empty main_set', () => {
    const { built, errors } = parseBuiltSessions(
      reply([{ key: '23003', description: 'x', intensity: 'tempo', structured_workout: { main_set: [] } }]),
      [SESSION], PACES
    )
    expect(built).toEqual([])
    expect(errors[0]).toContain('no main_set')
  })

  it('reports a session the model omitted', () => {
    const { built, errors } = parseBuiltSessions(reply([]), [SESSION], PACES)
    expect(built).toEqual([])
    expect(errors).toEqual(['23003: no session returned'])
  })

  it('tolerates prose and markdown fences around the JSON', () => {
    const raw = 'Here you go:\n```json\n' +
      reply([{ key: '23003', description: 'Q2: ok', intensity: 'tempo', structured_workout: GOOD_STRUCTURE }]) +
      '\n```\nHope that helps.'
    const { built, errors } = parseBuiltSessions(raw, [SESSION], PACES)
    expect(errors).toEqual([])
    expect(built[0].description).toBe('Q2: ok')
  })

  it('falls back to the prescription when no description is returned', () => {
    const { built } = parseBuiltSessions(
      reply([{ key: '23003', intensity: 'tempo', structured_workout: GOOD_STRUCTURE }]),
      [SESSION], PACES
    )
    expect(built[0].description).toBe(SESSION.prescription)
  })

  it('surfaces unparseable output rather than throwing', () => {
    const { built, errors } = parseBuiltSessions('the model refused', [SESSION], PACES)
    expect(built).toEqual([])
    expect(errors[0]).toContain('Could not parse response')
  })

  it('only returns sessions that were asked for', () => {
    const { built } = parseBuiltSessions(
      reply([
        { key: '23003', description: 'wanted', intensity: 'tempo', structured_workout: GOOD_STRUCTURE },
        { key: '99999', description: 'not asked for', intensity: 'tempo', structured_workout: GOOD_STRUCTURE },
      ]),
      [SESSION], PACES
    )
    expect(built.map(b => b.key)).toEqual(['23003'])
  })
})

describe('parseBuiltSessions from a tool call', () => {
  it('accepts the forced tool call arguments object directly', () => {
    const { built, errors } = parseBuiltSessions(
      { sessions: [{ key: '23003', description: 'Q2: via tool', intensity: 'tempo', structured_workout: GOOD_STRUCTURE }] },
      [SESSION], PACES
    )
    expect(errors).toEqual([])
    expect(built[0].description).toBe('Q2: via tool')
  })

  it('reports an empty response instead of throwing', () => {
    const { built, errors } = parseBuiltSessions(undefined, [SESSION], PACES)
    expect(built).toEqual([])
    expect(errors).toEqual(['Empty response'])
  })

  it('surfaces prose the model returned instead of the tool call', () => {
    const prose = 'Here are the structured workouts.\n\n**Effort Level Definitions:**\n- E (Easy): conversational.'
    const { built, errors, rawResponse } = parseBuiltSessions(prose, [SESSION], PACES)
    expect(built).toEqual([])
    expect(errors[0]).toContain('Could not parse response')
    expect(rawResponse).toBe(prose)
  })
})

describe('buildEmitSessionsTool', () => {
  it('requires the fields the writer depends on', () => {
    const tool = buildEmitSessionsTool()
    expect(tool.name).toBe(EMIT_TOOL_NAME)
    const items = (tool.parameters as Record<string, any>).properties.sessions.items
    expect(items.required).toEqual(['key', 'description', 'intensity', 'structured_workout'])
    expect(Object.keys(items.properties)).toContain('pace_guidance')
  })

  // Regression: a bare { type: 'object' } for structured_workout returned {} for
  // every session, because Gemini emits only what the schema declares.
  it('declares main_set down to the interval step', () => {
    const items = (buildEmitSessionsTool().parameters as Record<string, any>).properties.sessions.items
    const sw = items.properties.structured_workout
    expect(sw.required).toEqual(['main_set'])
    const group = sw.properties.main_set.items
    expect(group.required).toEqual(['repeat', 'intervals'])
    const step = group.properties.intervals.items
    expect(Object.keys(step.properties).sort()).toEqual(
      ['distance_meters', 'duration_seconds', 'intensity', 'role']
    )
    expect(step.properties.role.enum).toEqual([...VALID_ROLES])
    expect(sw.properties.warmup.properties.duration_minutes.type).toBe('number')
  })

  it('leaves no schema object without declared properties', () => {
    const walk = (node: any, path: string): string[] => {
      if (!node || typeof node !== 'object') return []
      const bad: string[] = []
      if (node.type === 'object' && !node.properties) bad.push(path)
      for (const [k, v] of Object.entries(node)) {
        if (v && typeof v === 'object') bad.push(...walk(v, `${path}.${k}`))
      }
      return bad
    }
    expect(walk(buildEmitSessionsTool().parameters, 'parameters')).toEqual([])
  })
})

describe('notation prompts', () => {
  const TEMPLATE = {
    name: 'JD 2Q 41-55',
    workout_notation: { E: 'Easy pace', T: 'Threshold pace', I: 'Interval pace' },
    pace_targets: { easy: {}, threshold: {}, interval: {} },
  } as unknown as FullTemplate

  it('carries the template notation, pace keys and the shared structured-workout contract', () => {
    const prompt = buildNotationSystemPrompt(TEMPLATE)
    expect(prompt).toContain('- E: Easy pace')
    expect(prompt).toContain('- threshold')
    expect(prompt).toContain('ROLE FIELD ON INTERVALS — REQUIRED:')
    expect(prompt).toContain('STRUCTURED WORKOUT:')
  })

  it('forbids the prose answer Gemini gave the first time', () => {
    const prompt = buildNotationSystemPrompt(TEMPLATE)
    expect(prompt).toContain(EMIT_TOOL_NAME)
    expect(prompt).toContain('never explain effort levels')
  })

  it('states each slot with its distance, W/C handling and prescription', () => {
    const msg = buildNotationUserMessage([SESSION])
    expect(msg).toContain('key: 23003')
    expect(msg).toContain('[W/C: included]')
    expect(msg).toContain('13 mi. (21 km)')
    expect(msg).toContain('"4E + 1T + 2M + 1E + 1T + 2M + 2E"')
  })

  it('marks plain steady runs so they are not built as sessions', () => {
    const msg = buildNotationUserMessage([{ ...SESSION, is_session: false, prescription: 'steady E run of 150 min' }])
    expect(msg).toContain('plain steady run')
  })
})

describe('buildPlainSteadyRun', () => {
  const STEADY: NotationSession = {
    key: '22972',
    prescription: 'steady E run of 120-150 min',
    workout_type: 'long_run',
    km: 27,
    is_session: false,
  }

  it('takes the distance from the template rather than a range reading', () => {
    const built = buildPlainSteadyRun(STEADY)
    expect(built.distance_target_meters).toBe(27000)
    expect(built.description).toBe('steady E run of 120-150 min')
    expect(built.intensity).toBe('easy')
  })

  it('emits a single easy main_set step', () => {
    const ms = buildPlainSteadyRun(STEADY).structured_workout.main_set as any[]
    expect(ms).toHaveLength(1)
    expect(ms[0].repeat).toBe(1)
    expect(ms[0].intervals).toHaveLength(1)
    expect(ms[0].intervals[0].distance_meters).toBe(27000)
  })

  it('leaves the existing duration alone', () => {
    expect(buildPlainSteadyRun(STEADY).duration_target_seconds).toBeUndefined()
  })
})

describe('rejected sessions', () => {
  it('reports the measured distance so it can be quoted back', () => {
    const short = { main_set: [{ repeat: 1, intervals: [{ distance_meters: 11300, intensity: 'threshold' }] }] }
    const { rejected } = parseBuiltSessions(
      reply([{ key: '23003', description: 'x', intensity: 'tempo', structured_workout: short }]),
      [SESSION], PACES
    )
    expect(rejected).toEqual([{ key: '23003', builtMeters: 11300 }])
  })

  it('tells the model what it dropped and what the total must be', () => {
    const msg = buildRetryUserMessage([SESSION], [{ key: '23003', builtMeters: 11300 }])
    expect(msg).toContain('summed to 11.3 km')
    expect(msg).toContain('must total 21 km')
    expect(msg).toContain('not just the reps')
  })

  it('ignores feedback for a session that was never requested', () => {
    expect(buildRetryUserMessage([SESSION], [{ key: 'nope', builtMeters: 1 }])).not.toContain('nope')
  })
})
