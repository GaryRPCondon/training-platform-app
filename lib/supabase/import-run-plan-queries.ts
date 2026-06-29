import type { SupabaseClient } from '@supabase/supabase-js'
import type { ImportedRunPlan } from '@/types/database'
import type { ParsedRunningPlan } from '@/lib/plans/import/schemas'

export interface InsertImportedRunPlanInput {
  name: string
  source_type: 'free_text' | 'json' | 'image'
  source_provider: string | null
  source_model: string | null
  parse_confidence: number | null
  parse_metadata: Record<string, unknown> | null
  definition: ParsedRunningPlan
  distance: string | null
  default_days_per_week: number | null
  total_weeks: number
}

/** Average non-rest workouts per week — a best-effort default for the library UI. */
export function deriveDefaultDaysPerWeek(definition: ParsedRunningPlan): number | null {
  if (definition.weeks.length === 0) return null
  const runDaysTotal = definition.weeks.reduce(
    (sum, w) => sum + w.workouts.filter(x => x.type !== 'rest').length,
    0,
  )
  const avg = Math.round(runDaysTotal / definition.weeks.length)
  return Math.min(7, Math.max(1, avg))
}

export async function insertImportedRunPlan(
  supabase: SupabaseClient,
  athleteId: string,
  input: InsertImportedRunPlanInput,
): Promise<ImportedRunPlan> {
  const { data, error } = await supabase
    .from('imported_run_plans')
    .insert({
      athlete_id: athleteId,
      name: input.name,
      source_type: input.source_type,
      source_provider: input.source_provider,
      source_model: input.source_model,
      parse_confidence: input.parse_confidence,
      parse_metadata: input.parse_metadata,
      definition: input.definition,
      distance: input.distance,
      default_days_per_week: input.default_days_per_week,
      total_weeks: input.total_weeks,
      status: 'active',
    })
    .select()
    .single()

  if (error) throw error
  return data as ImportedRunPlan
}

export interface ImportedRunPlanListItem extends ImportedRunPlan {
  application_count: number
}

export async function listImportedRunPlans(
  supabase: SupabaseClient,
  athleteId: string,
): Promise<ImportedRunPlanListItem[]> {
  const { data, error } = await supabase
    .from('imported_run_plans')
    .select('*, imported_run_plan_applications(count)')
    .eq('athlete_id', athleteId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })

  if (error) throw error

  return (data ?? []).map(row => {
    const { imported_run_plan_applications, ...rest } = row as ImportedRunPlan & {
      imported_run_plan_applications?: Array<{ count: number }>
    }
    return {
      ...(rest as ImportedRunPlan),
      application_count: imported_run_plan_applications?.[0]?.count ?? 0,
    }
  })
}

export async function getImportedRunPlan(
  supabase: SupabaseClient,
  athleteId: string,
  id: number,
): Promise<ImportedRunPlan | null> {
  const { data, error } = await supabase
    .from('imported_run_plans')
    .select('*')
    .eq('id', id)
    .eq('athlete_id', athleteId)
    .eq('status', 'active')
    .maybeSingle()

  if (error) throw error
  return (data as ImportedRunPlan) ?? null
}

/** Soft-delete: keep materialized plans intact, hide the definition from the library. */
export async function softDeleteImportedRunPlan(
  supabase: SupabaseClient,
  athleteId: string,
  id: number,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('imported_run_plans')
    .update({ status: 'deleted' })
    .eq('id', id)
    .eq('athlete_id', athleteId)
    .eq('status', 'active')
    .select('id')
    .maybeSingle()

  if (error) throw error
  return data != null
}
