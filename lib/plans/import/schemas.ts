import { z } from 'zod'
import { RUN_INTENSITIES } from '@/lib/plans/import/intensity'

// ---------------------------------------------------------------------------
// Workout types — must stay in sync with planned_workouts.workout_type enum
// (types/database.ts). The parser maps source descriptions onto these.
// ---------------------------------------------------------------------------
export const workoutTypeSchema = z.enum([
  'easy_run',
  'long_run',
  'intervals',
  'tempo',
  'rest',
  'cross_training',
  'recovery',
  'race',
])
export type ImportWorkoutType = z.infer<typeof workoutTypeSchema>

export const phaseSchema = z.enum(['base', 'build', 'peak', 'taper'])
export const runIntensitySchema = z.enum(RUN_INTENSITIES)

// ---------------------------------------------------------------------------
// One workout (one day). structured_workout is passed through opaquely — it
// aligns with planned_workouts.structured_workout and is validated/used by the
// existing plan-writer, not re-modelled here.
// ---------------------------------------------------------------------------
export const importedWorkoutSchema = z.object({
  day_of_week: z.number().int().min(1).max(7), // Mon=1 .. Sun=7
  type: workoutTypeSchema,
  description: z.string().min(1),
  distance_meters: z.number().int().min(0).nullable().optional(),
  duration_seconds: z.number().int().min(0).nullable().optional(),
  // Canonical token when classifiable; null when the source effort couldn't be
  // confidently mapped (kept verbatim in description + a parse warning).
  intensity: runIntensitySchema.nullable().optional(),
  // Explicit clock pace from the source (e.g. "4:30/km"), preferred over VDOT
  // resolution when present. Free text; normalized downstream.
  pace_literal: z.string().nullable().optional(),
  structured_workout: z.record(z.string(), z.unknown()).nullable().optional(),
  notes: z.string().nullable().optional(),
})
export type ImportedWorkout = z.infer<typeof importedWorkoutSchema>

// ---------------------------------------------------------------------------
// One training week. week_index is 1-based ASCENDING (training order), even
// when the source counts "weeks to goal" downward — normalize handles the flip.
// ---------------------------------------------------------------------------
export const importedWeekSchema = z.object({
  week_index: z.number().int().min(1),
  phase: phaseSchema.nullable().optional(),
  label: z.string().nullable().optional(), // verbatim source label e.g. "Mesocycle 2 wk 3"
  workouts: z.array(importedWorkoutSchema).min(1),
})
export type ImportedWeek = z.infer<typeof importedWeekSchema>

// ---------------------------------------------------------------------------
// ParsedRunningPlan — the normalized definition persisted in
// imported_run_plans.definition and re-fitted on each apply.
/**
 * A defaulted list at an LLM boundary. `.default()` substitutes for `undefined`
 * only, so a bare `z.array(...).default([])` rejects an explicit `null` — and
 * models routinely emit null for "none" rather than omitting the key. This is the
 * drift that broke strength parsing (see lib/strength/schemas.ts).
 */
const llmListWithDefault = z.preprocess(
  v => (v === null ? undefined : v),
  z.array(z.string()).default([]),
)

// ---------------------------------------------------------------------------
export const parsedRunningPlanSchema = z.object({
  schema_version: z.literal('1.0'),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  distance: z.string().nullable().optional(), // '5k'|'10k'|'half'|'marathon'|'other'
  detected_race_week: z.number().int().min(1).nullable().optional(),
  weeks: z.array(importedWeekSchema).min(1),
  parse_warnings: llmListWithDefault,
})
export type ParsedRunningPlan = z.infer<typeof parsedRunningPlanSchema>

// LLM wraps the plan + meta in a single response object (refuse-safely: never
// throw — set content_type 'other' + low confidence + a warning instead).
export const parseLLMResultSchema = z.object({
  plan: parsedRunningPlanSchema,
  confidence: z.number().min(0).max(1),
  content_type: z.enum(['running', 'other']),
  warnings: llmListWithDefault,
})
export type ParseLLMResult = z.infer<typeof parseLLMResultSchema>

// ---------------------------------------------------------------------------
// API request bodies
// ---------------------------------------------------------------------------
export const parseRequestSchema = z.object({
  source_type: z.enum(['free_text', 'json', 'image']),
  // text/json inputs (Phase 1). Images arrive in Phase 2 as base64 parts.
  text: z.string().min(1).max(200_000).optional(),
  images: z
    .array(z.object({ mimeType: z.string().min(1), dataBase64: z.string().min(1) }))
    .min(1)
    .max(20)
    .optional(),
}).refine(
  d => (d.source_type === 'image' ? !!d.images : !!d.text),
  { message: 'text is required for free_text/json; images required for image' },
)
export type ParseRequest = z.infer<typeof parseRequestSchema>

export const fitModeSchema = z.enum(['exact', 'compress', 'stretch', 'llm_adapt'])
export type FitMode = z.infer<typeof fitModeSchema>

// Accept: persist the (already reviewed, possibly edited) definition only.
// Scheduling onto a race window is a separate, LLM-tailored step (see the
// imported-plan generate route) — import no longer materialises a plan.
export const createImportRequestSchema = z.object({
  name: z.string().min(1).max(200),
  source_type: z.enum(['free_text', 'json', 'image']),
  source_provider: z.string().nullable().optional(),
  source_model: z.string().nullable().optional(),
  parse_confidence: z.number().min(0).max(1).nullable().optional(),
  parse_metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  definition: parsedRunningPlanSchema,
})
export type CreateImportRequest = z.infer<typeof createImportRequestSchema>

// Schedule an existing definition onto a race window — the user's parameters
// drive an LLM tailoring pass (mirrors template generation). VDOT optional.
export const generateImportRequestSchema = z.object({
  goal_name: z.string().min(1).max(200),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  goal_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  goal_type: z.string().min(1), // race distance key
  current_weekly_mileage: z.number().min(0),
  comfortable_peak_mileage: z.number().min(0),
  days_per_week: z.number().int().min(1).max(7),
  preferred_rest_days: z.array(z.number().int().min(0).max(6)).optional(),
  vdot_data: z.object({
    vdot: z.number(),
    source: z.string().optional(),
    sourceData: z.record(z.string(), z.unknown()).optional(),
  }).nullable().optional(),
  replace_active: z.boolean().optional(),
})
export type GenerateImportRequest = z.infer<typeof generateImportRequestSchema>
