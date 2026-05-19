import { SupabaseClient } from '@supabase/supabase-js'
import {
  StrengthProgram,
  StrengthSession,
  StrengthExerciseCatalog,
  StrengthExercise,
  ParsedStrengthProgram,
} from '@/types/database'

type Client = SupabaseClient

export async function listPrograms(supabase: Client, athleteId: string): Promise<StrengthProgram[]> {
  const { data, error } = await supabase
    .from('strength_programs')
    .select('*')
    .eq('athlete_id', athleteId)
    .in('status', ['active', 'completed'])
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as StrengthProgram[]
}

export async function getProgramWithSessions(
  supabase: Client,
  athleteId: string,
  programId: number,
): Promise<{ program: StrengthProgram; sessions: StrengthSession[] } | null> {
  const { data: program, error: progErr } = await supabase
    .from('strength_programs')
    .select('*')
    .eq('id', programId)
    .eq('athlete_id', athleteId)
    .maybeSingle()
  if (progErr) throw progErr
  if (!program) return null

  const { data: sessions, error: sessErr } = await supabase
    .from('strength_sessions')
    .select('*')
    .eq('program_id', programId)
    .eq('athlete_id', athleteId)
    .order('session_index', { ascending: true })
  if (sessErr) throw sessErr

  return { program: program as StrengthProgram, sessions: (sessions ?? []) as StrengthSession[] }
}

export async function getSessionsForDateRange(
  supabase: Client,
  athleteId: string,
  startDate: string,
  endDate: string,
): Promise<StrengthSession[]> {
  const { data, error } = await supabase
    .from('strength_sessions')
    .select('*')
    .eq('athlete_id', athleteId)
    .gte('scheduled_date', startDate)
    .lte('scheduled_date', endDate)
    .order('scheduled_date', { ascending: true })
    .order('display_order', { ascending: true })
  if (error) throw error
  return (data ?? []) as StrengthSession[]
}

export async function getSessionById(
  supabase: Client,
  athleteId: string,
  sessionId: number,
): Promise<StrengthSession | null> {
  const { data, error } = await supabase
    .from('strength_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('athlete_id', athleteId)
    .maybeSingle()
  if (error) throw error
  return (data as StrengthSession | null) ?? null
}

export async function createProgramWithSessions(
  supabase: Client,
  athleteId: string,
  input: {
    name: string
    source_text: string | null
    source_format: 'free_text' | 'json'
    parsed_program: ParsedStrengthProgram
    parse_confidence: number | null
    parse_metadata: Record<string, unknown> | null
    cadence_days: number
    start_date: string
    placements: Array<{ session_index: number; scheduled_date: string; placement_rationale: string }>
  },
): Promise<{ program: StrengthProgram; sessions: StrengthSession[] }> {
  const { data: program, error: progErr } = await supabase
    .from('strength_programs')
    .insert({
      athlete_id: athleteId,
      name: input.name,
      source_text: input.source_text,
      source_format: input.source_format,
      parsed_program: input.parsed_program,
      parse_confidence: input.parse_confidence,
      parse_metadata: input.parse_metadata,
      cadence_days: input.cadence_days,
      start_date: input.start_date,
      status: 'active',
    })
    .select('*')
    .single()
  if (progErr) throw progErr

  const sessionsToInsert = input.parsed_program.sessions.map(ps => {
    const placement = input.placements.find(p => p.session_index === ps.session_index)
    if (!placement) throw new Error(`Missing placement for session_index ${ps.session_index}`)
    return {
      program_id: program.id,
      athlete_id: athleteId,
      session_index: ps.session_index,
      scheduled_date: placement.scheduled_date,
      display_order: 1,
      title: ps.title,
      exercises: ps.exercises as unknown as StrengthExercise[],
      estimated_duration_minutes: ps.estimated_duration_minutes ?? null,
      placement_rationale: placement.placement_rationale,
      coaching_note: ps.coaching_note ?? null,
    }
  })

  const { data: sessions, error: sessErr } = await supabase
    .from('strength_sessions')
    .insert(sessionsToInsert)
    .select('*')
  if (sessErr) {
    // Best-effort rollback: delete the program (cascade removes any partial sessions).
    await supabase.from('strength_programs').delete().eq('id', program.id)
    throw sessErr
  }

  return {
    program: program as StrengthProgram,
    sessions: (sessions ?? []) as StrengthSession[],
  }
}

export async function updateSessionCompletion(
  supabase: Client,
  athleteId: string,
  sessionId: number,
  patch: {
    completion_status?: 'pending' | 'completed' | 'partial' | 'skipped'
    actual_duration_minutes?: number | null
    completion_notes?: string | null
  },
): Promise<StrengthSession> {
  const update: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() }
  if (patch.completion_status === 'completed') {
    update.completed_at = new Date().toISOString()
  } else if (patch.completion_status !== undefined) {
    update.completed_at = null
  }

  const { data, error } = await supabase
    .from('strength_sessions')
    .update(update)
    .eq('id', sessionId)
    .eq('athlete_id', athleteId)
    .select('*')
    .single()
  if (error) throw error
  return data as StrengthSession
}

export async function rescheduleSession(
  supabase: Client,
  athleteId: string,
  sessionId: number,
  newDate: string,
): Promise<StrengthSession> {
  // Mark Garmin sync stale if previously synced (mirrors planned_workouts pattern).
  const { data: existing, error: fetchErr } = await supabase
    .from('strength_sessions')
    .select('garmin_workout_id, garmin_sync_status')
    .eq('id', sessionId)
    .eq('athlete_id', athleteId)
    .single()
  if (fetchErr) throw fetchErr

  const update: Record<string, unknown> = {
    scheduled_date: newDate,
    updated_at: new Date().toISOString(),
  }
  if (existing?.garmin_workout_id && existing.garmin_sync_status === 'synced') {
    update.garmin_sync_status = 'stale'
  }

  const { data, error } = await supabase
    .from('strength_sessions')
    .update(update)
    .eq('id', sessionId)
    .eq('athlete_id', athleteId)
    .select('*')
    .single()
  if (error) throw error
  return data as StrengthSession
}

/**
 * Soft-delete a program. Per the approved UX: completed sessions stay (so the
 * athlete keeps their training history), pending/partial/skipped sessions are
 * removed, and the program row flips to status='deleted' so the UI can render
 * an "archived program" badge on the surviving sessions.
 */
export async function deleteProgram(supabase: Client, athleteId: string, programId: number): Promise<void> {
  // Verify ownership first.
  const { data: program, error: fetchErr } = await supabase
    .from('strength_programs')
    .select('id')
    .eq('id', programId)
    .eq('athlete_id', athleteId)
    .maybeSingle()
  if (fetchErr) throw fetchErr
  if (!program) throw new Error('Program not found')

  // Remove non-completed sessions.
  const { error: delErr } = await supabase
    .from('strength_sessions')
    .delete()
    .eq('program_id', programId)
    .eq('athlete_id', athleteId)
    .in('completion_status', ['pending', 'partial', 'skipped'])
  if (delErr) throw delErr

  // Mark the program archived. We keep the row so completed sessions retain
  // their FK and we can show "from archived program".
  const { error: updErr } = await supabase
    .from('strength_programs')
    .update({ status: 'deleted', updated_at: new Date().toISOString() })
    .eq('id', programId)
    .eq('athlete_id', athleteId)
  if (updErr) throw updErr
}

export async function loadExerciseCatalog(supabase: Client): Promise<StrengthExerciseCatalog[]> {
  const { data, error } = await supabase
    .from('strength_exercise_catalog')
    .select('*')
    .order('canonical_name', { ascending: true })
  if (error) throw error
  return (data ?? []) as StrengthExerciseCatalog[]
}
