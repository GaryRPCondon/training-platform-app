import { z } from 'zod'

// ---------------------------------------------------------------------------
// Exercise — one item inside a session's exercises[] JSONB column.
// ---------------------------------------------------------------------------
export const exerciseMeasurementSchema = z.object({
  type: z.enum(['reps', 'duration', 'distance']),
  sets: z.number().int().min(1),
  reps_per_set: z.number().int().min(1).optional(),
  duration_seconds: z.number().int().min(1).optional(),
  distance_meters: z.number().int().min(1).optional(),
  weight_kg: z.number().min(0).nullable().optional(),
  rest_seconds: z.number().int().min(0).optional(),
}).refine(
  m => (m.type === 'reps' && m.reps_per_set !== undefined) ||
       (m.type === 'duration' && m.duration_seconds !== undefined) ||
       (m.type === 'distance' && m.distance_meters !== undefined),
  { message: 'measurement.type must have its matching value field populated' },
)

export const exerciseSchema = z.object({
  canonical_name: z.string().min(1),
  display_name: z.string().min(1),
  user_text: z.string().min(1),
  measurement: exerciseMeasurementSchema,
  garmin_supported: z.boolean(),
  garmin_unsupported_reason: z.string().optional(),
  notes: z.string().optional(),
  // LLM-suggested Garmin enum mapping. Only stamped onto the persisted
  // exercise when garmin_suggested_confidence === 'exact' AND the pair is
  // verbatim-known in the canonical enum (lib/garmin/exercise-enum.ts).
  garmin_suggested_category: z.string().optional(),
  garmin_suggested_name: z.string().optional(),
  garmin_suggested_confidence: z.enum(['exact', 'partial', 'none']).optional(),
  // Verified-and-stamped enum (persisted on strength_sessions.exercises).
  garmin_exercise_category: z.string().optional(),
  garmin_exercise_name: z.string().optional(),
})

// ---------------------------------------------------------------------------
// ParsedProgram — what the LLM emits for parsing free-text into structured data.
// ---------------------------------------------------------------------------
export const parsedSessionSchema = z.object({
  session_index: z.number().int().min(1),
  title: z.string().min(1),
  exercises: z.array(exerciseSchema).min(1),
  estimated_duration_minutes: z.number().int().min(1).optional(),
  coaching_note: z.string().optional(),
})

export const parsedProgramSchema = z.object({
  schema_version: z.literal('1.0'),
  content_type: z.enum(['strength', 'mobility', 'mixed']),
  name: z.string().min(1),
  description: z.string().optional(),
  sessions: z.array(parsedSessionSchema).min(1),
  parse_warnings: z.array(z.string()).optional(),
})

// LLM wraps ParsedProgram + meta in a single response object.
export const parseLLMResultSchema = z.object({
  program: parsedProgramSchema,
  confidence: z.number().min(0).max(1),
  // 'other' lets the LLM tell us the input wasn't a strength plan at all.
  content_type: z.enum(['strength', 'mobility', 'mixed', 'other']),
  warnings: z.array(z.string()).default([]),
})

// ---------------------------------------------------------------------------
// API request bodies
// ---------------------------------------------------------------------------
export const parseRequestSchema = z.object({
  text: z.string().min(1).max(50_000),
  source_format: z.enum(['free_text', 'json']),
})

// program_type: how the user described the program.
//   'fixed'  — every session of every week is written out; schedule each once.
//   'weekly' — one week of sessions; repeat the set for `weeks_to_repeat` weeks.
export const programTypeSchema = z.enum(['fixed', 'weekly'])

export const scheduleRequestSchema = z.object({
  parsedProgram: parsedProgramSchema,
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be YYYY-MM-DD'),
  programType: programTypeSchema,
  weeksToRepeat: z.number().int().min(1).max(52).optional(),
}).refine(
  data => data.programType === 'fixed' || data.weeksToRepeat !== undefined,
  { message: 'weeksToRepeat is required when programType is "weekly"' },
)

export const createProgramRequestSchema = z.object({
  name: z.string().min(1),
  source_text: z.string().nullable(),
  source_format: z.enum(['free_text', 'json']),
  parsed_program: parsedProgramSchema,
  parse_confidence: z.number().min(0).max(1).nullable(),
  parse_metadata: z.record(z.string(), z.unknown()).nullable(),
  program_type: programTypeSchema,
  weeks_to_repeat: z.number().int().min(1).max(52).nullable(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  placements: z.array(z.object({
    session_index: z.number().int().min(1),
    scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    placement_rationale: z.string(),
  })).min(1),
}).refine(
  data => data.program_type === 'fixed' || (data.weeks_to_repeat !== null && data.weeks_to_repeat !== undefined),
  { message: 'weeks_to_repeat is required when program_type is "weekly"' },
)

export const rescheduleSessionSchema = z.object({
  sessionId: z.number().int().min(1),
  newDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export const updateSessionSchema = z.object({
  completion_status: z.enum(['pending', 'completed', 'partial', 'skipped']).optional(),
  actual_duration_minutes: z.number().int().min(0).nullable().optional(),
  completion_notes: z.string().nullable().optional(),
  exercises: z.array(exerciseSchema).min(1).optional(),
})

// Inferred TS types — use these everywhere instead of re-defining shape.
export type ExerciseMeasurement = z.infer<typeof exerciseMeasurementSchema>
export type Exercise = z.infer<typeof exerciseSchema>
export type ParsedSession = z.infer<typeof parsedSessionSchema>
export type ParsedProgram = z.infer<typeof parsedProgramSchema>
export type ParseLLMResult = z.infer<typeof parseLLMResultSchema>
export type CreateProgramRequest = z.infer<typeof createProgramRequestSchema>
