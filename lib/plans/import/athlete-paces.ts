import type { SupabaseClient } from '@supabase/supabase-js'
import {
  calculateTrainingPaces,
  calculateRacePaces,
  type AllTrainingPaces,
} from '@/lib/training/vdot'

/**
 * Load the athlete's VDOT-derived paces for import pace resolution. Returns
 * nulls when the athlete has no VDOT on file — the imported plan still applies,
 * just with qualitative-only paces (resolveImportPace returns null per workout).
 * Mirrors how plan generation builds paces (generate route / active-plan-pace).
 */
export async function loadAthletePaces(
  supabase: SupabaseClient,
  athleteId: string,
): Promise<{ athletePaces: AllTrainingPaces | null; vdot: number | null }> {
  const { data } = await supabase
    .from('athletes')
    .select('vdot')
    .eq('id', athleteId)
    .maybeSingle()

  const vdot = typeof data?.vdot === 'number' ? data.vdot : null
  if (vdot == null) return { athletePaces: null, vdot: null }

  return {
    athletePaces: { ...calculateTrainingPaces(vdot), ...calculateRacePaces(vdot) },
    vdot,
  }
}
