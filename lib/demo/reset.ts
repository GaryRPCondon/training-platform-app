/**
 * Demo account reset: wipe every row owned by the demo athlete, then re-clone a
 * fresh copy from the owner's live account with full foreign-key remapping.
 *
 * SERVICE ROLE ONLY. Called by app/api/jobs/reset-demo/route.ts (nightly cron +
 * on-demand admin trigger).
 *
 * SAFETY — this touches the live database. Two invariants make it safe:
 *   1. Every DELETE is filtered to the demo athlete (directly by athlete_id, or
 *      via a parent-id set that was itself gathered by athlete_id = demo). The
 *      source athlete's rows are only ever READ, never written.
 *   2. assertSafeConfig() aborts unless demoUserId and sourceAthleteId are both
 *      present and DISTINCT, and the demo athlete row is confirmed is_demo=true.
 *      A misconfiguration can therefore never wipe the owner's real data.
 *
 * The wipe order deletes referencing rows before referenced rows so it holds even
 * for the non-cascade FKs; the clone order inserts parents before children,
 * breaking the activities <-> planned_workouts cycle by deferring
 * planned_workouts.completed_activity_id and back-filling it last.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface DemoResetConfig {
  demoUserId: string
  sourceAthleteId: string
  demoEmail: string
  demoPassword: string
}

export interface DemoResetResult {
  wiped: Record<string, number>
  cloned: Record<string, number>
}

const INSERT_CHUNK = 500
// PostgREST caps every SELECT response at this many rows by default. Source reads
// MUST paginate past it, or large tables (activities, laps) clone truncated — and
// because we order by id, the truncation silently drops the most RECENT rows.
const PAGE_SIZE = 1000

// --- pure helpers (unit-tested) -------------------------------------------------

type Row = Record<string, unknown>
type IdMap = Map<number, number>

/**
 * Correlate source rows with the ids returned from their insert, by position.
 * A single PostgREST INSERT returns rows in input order, so index alignment maps
 * old id -> new id. Throws on a length mismatch (a corrupted clone must fail loud).
 */
export function buildIdMap(sourceRows: { id: number }[], insertedIds: { id: number }[]): IdMap {
  if (sourceRows.length !== insertedIds.length) {
    throw new Error(`buildIdMap length mismatch: ${sourceRows.length} source vs ${insertedIds.length} inserted`)
  }
  const map: IdMap = new Map()
  for (let i = 0; i < sourceRows.length; i++) {
    map.set(sourceRows[i].id, insertedIds[i].id)
  }
  return map
}

/** Remap a single FK value through a map; null stays null, and an unmapped id becomes null (never a dangling ref). */
export function remapId(map: IdMap, value: unknown): number | null {
  if (value == null) return null
  const mapped = map.get(value as number)
  return mapped ?? null
}

export interface RemapSpec {
  /** Overwrite athlete_id with the demo id when the column is present. */
  demoAthleteId: string
  /** FK columns to remap: column name -> id map. */
  remaps?: Record<string, IdMap>
  /** Columns to force to null (deferred cycle refs, stale unenforced refs). */
  nullColumns?: string[]
}

/**
 * Turn a source row into an insert payload for the demo account: drop the PK so
 * the sequence issues a fresh one, point athlete_id at the demo athlete, remap FK
 * columns, and null out deferred/stale columns. Pure — no DB access.
 */
export function remapForInsert(row: Row, spec: RemapSpec): Row {
  const out: Row = { ...row }
  delete out.id
  if ('athlete_id' in out) out.athlete_id = spec.demoAthleteId
  for (const [col, map] of Object.entries(spec.remaps ?? {})) {
    if (col in out) out[col] = remapId(map, out[col])
  }
  for (const col of spec.nullColumns ?? []) {
    if (col in out) out[col] = null
  }
  return out
}

// --- orchestration --------------------------------------------------------------

async function assertSafeConfig(admin: SupabaseClient, config: DemoResetConfig): Promise<void> {
  const { demoUserId, sourceAthleteId } = config
  if (!demoUserId || !sourceAthleteId) {
    throw new Error('demo reset aborted: demoUserId and sourceAthleteId are both required')
  }
  if (demoUserId === sourceAthleteId) {
    throw new Error('demo reset aborted: demoUserId must differ from sourceAthleteId (would wipe the source)')
  }
  const { data: demoAthlete, error } = await admin
    .from('athletes')
    .select('id, is_demo')
    .eq('id', demoUserId)
    .single()
  if (error || !demoAthlete) {
    throw new Error(`demo reset aborted: demo athlete ${demoUserId} not found`)
  }
  if (demoAthlete.is_demo !== true) {
    throw new Error(`demo reset aborted: athlete ${demoUserId} is not flagged is_demo — refusing to wipe`)
  }
}

/** Paginated SELECT id WHERE column = value (past the PostgREST row cap). */
async function demoParentIds(admin: SupabaseClient, table: string, column: string, value: string | number): Promise<number[]> {
  const ids: number[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await admin.from(table).select('id').eq(column, value)
      .order('id', { ascending: true }).range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`gather ${table} ids failed: ${error.message}`)
    const batch = data ?? []
    ids.push(...batch.map(r => (r as { id: number }).id))
    if (batch.length < PAGE_SIZE) break
  }
  return ids
}

/** Paginated SELECT id WHERE column IN (parentIds), for child tables with no athlete_id. */
async function demoChildIds(admin: SupabaseClient, table: string, column: string, parentIds: number[]): Promise<number[]> {
  if (parentIds.length === 0) return []
  const ids: number[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await admin.from(table).select('id').in(column, parentIds)
      .order('id', { ascending: true }).range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`gather ${table} ids failed: ${error.message}`)
    const batch = data ?? []
    ids.push(...batch.map(r => (r as { id: number }).id))
    if (batch.length < PAGE_SIZE) break
  }
  return ids
}

async function deleteWhereIn(admin: SupabaseClient, table: string, column: string, ids: number[]): Promise<number> {
  if (ids.length === 0) return 0
  let total = 0
  for (let i = 0; i < ids.length; i += INSERT_CHUNK) {
    const chunk = ids.slice(i, i + INSERT_CHUNK)
    const { error, count } = await admin.from(table).delete({ count: 'exact' }).in(column, chunk)
    if (error) throw new Error(`wipe ${table} failed: ${error.message}`)
    total += count ?? 0
  }
  return total
}

async function deleteWhereEq(admin: SupabaseClient, table: string, column: string, value: string): Promise<number> {
  const { error, count } = await admin.from(table).delete({ count: 'exact' }).eq(column, value)
  if (error) throw new Error(`wipe ${table} failed: ${error.message}`)
  return count ?? 0
}

/**
 * Read all demo-owned rows from a source table and insert remapped copies for the
 * demo athlete. Returns the old->new id map (for tables whose ids are referenced
 * downstream) plus the source rows (for post-insert back-fills).
 */
async function cloneTable(
  admin: SupabaseClient,
  table: string,
  filter: { column: string; eq?: string; in?: number[] },
  spec: RemapSpec,
): Promise<{ idMap: IdMap; sourceRows: Row[]; inserted: number }> {
  if (filter.in !== undefined && filter.in.length === 0) return { idMap: new Map(), sourceRows: [], inserted: 0 }

  // Read ALL source rows. Two caps to defeat: PostgREST returns at most PAGE_SIZE
  // rows (so paginate with .range), and a huge IN(...) list makes an over-long
  // request URL (so chunk the filter list). Order by id so pages are stable and
  // aligned with insert order for buildIdMap.
  const rows: Row[] = []
  // Read one filter-slice, paginating past PAGE_SIZE. ids=null means the .eq filter.
  const readSlice = async (ids: number[] | null) => {
    for (let from = 0; ; from += PAGE_SIZE) {
      let query = admin.from(table).select('*')
      if (filter.eq !== undefined) query = query.eq(filter.column, filter.eq)
      else if (ids) query = query.in(filter.column, ids)
      const { data, error } = await query.order('id', { ascending: true }).range(from, from + PAGE_SIZE - 1)
      if (error) throw new Error(`read source ${table} failed: ${error.message}`)
      const batch = (data ?? []) as Row[]
      rows.push(...batch)
      if (batch.length < PAGE_SIZE) break
    }
  }

  if (filter.eq !== undefined) {
    await readSlice(null)
  } else if (filter.in !== undefined) {
    const IN_CHUNK = 300 // keep the IN(...) list short enough for the request URL
    for (let i = 0; i < filter.in.length; i += IN_CHUNK) {
      await readSlice(filter.in.slice(i, i + IN_CHUNK))
    }
  }
  if (rows.length === 0) return { idMap: new Map(), sourceRows: [], inserted: 0 }

  const idMap: IdMap = new Map()
  let inserted = 0
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK)
    const payload = chunk.map(r => remapForInsert(r, spec))
    const { data: insertedRows, error: insErr } = await admin.from(table).insert(payload).select('id')
    if (insErr) throw new Error(`clone ${table} insert failed: ${insErr.message}`)
    const chunkMap = buildIdMap(chunk as { id: number }[], (insertedRows ?? []) as { id: number }[])
    for (const [k, v] of chunkMap) idMap.set(k, v)
    inserted += insertedRows?.length ?? 0
  }
  return { idMap, sourceRows: rows, inserted }
}

/**
 * Full reset: restore demo auth credentials, wipe demo-owned data, re-clone from
 * the source athlete. Idempotent — safe to re-run (e.g. the admin retry button).
 */
export async function resetDemoAccount(admin: SupabaseClient, config: DemoResetConfig): Promise<DemoResetResult> {
  await assertSafeConfig(admin, config)
  const demo = config.demoUserId
  const source = config.sourceAthleteId

  // 1. Restore auth (recover from any credential vandalism during the day).
  const { error: authErr } = await admin.auth.admin.updateUserById(demo, {
    email: config.demoEmail,
    password: config.demoPassword,
    email_confirm: true,
  })
  if (authErr) throw new Error(`restore demo auth failed: ${authErr.message}`)

  // 2. Wipe — gather demo parent ids first so child tables (no athlete_id) can be
  //    scoped, then delete referencing rows before referenced rows.
  const demoActivityIds = await demoParentIds(admin, 'activities', 'athlete_id', demo)
  const demoSessionIds = await demoParentIds(admin, 'chat_sessions', 'athlete_id', demo)
  const demoPlanIds = await demoParentIds(admin, 'training_plans', 'athlete_id', demo)
  const demoPhaseIds = await demoChildIds(admin, 'training_phases', 'plan_id', demoPlanIds)

  const wiped: Record<string, number> = {}
  wiped.activity_streams = await deleteWhereIn(admin, 'activity_streams', 'activity_id', demoActivityIds)
  wiped.laps = await deleteWhereIn(admin, 'laps', 'activity_id', demoActivityIds)
  wiped.chat_messages = await deleteWhereIn(admin, 'chat_messages', 'session_id', demoSessionIds)
  wiped.phase_progress = await deleteWhereIn(admin, 'phase_progress', 'phase_id', demoPhaseIds)
  wiped.plan_adjustments = await deleteWhereEq(admin, 'plan_adjustments', 'athlete_id', demo)
  wiped.workout_feedback = await deleteWhereEq(admin, 'workout_feedback', 'athlete_id', demo)
  wiped.workout_flags = await deleteWhereEq(admin, 'workout_flags', 'athlete_id', demo)
  wiped.imported_run_plan_applications = await deleteWhereEq(admin, 'imported_run_plan_applications', 'athlete_id', demo)
  wiped.strength_sessions = await deleteWhereEq(admin, 'strength_sessions', 'athlete_id', demo)
  wiped.chat_sessions = await deleteWhereEq(admin, 'chat_sessions', 'athlete_id', demo)
  wiped.planned_workouts = await deleteWhereEq(admin, 'planned_workouts', 'athlete_id', demo)
  wiped.activities = await deleteWhereEq(admin, 'activities', 'athlete_id', demo)
  wiped.weekly_plans = await deleteWhereEq(admin, 'weekly_plans', 'athlete_id', demo)
  wiped.training_phases = await deleteWhereIn(admin, 'training_phases', 'plan_id', demoPlanIds)
  wiped.training_plans = await deleteWhereEq(admin, 'training_plans', 'athlete_id', demo)
  wiped.imported_run_plans = await deleteWhereEq(admin, 'imported_run_plans', 'athlete_id', demo)
  wiped.strength_programs = await deleteWhereEq(admin, 'strength_programs', 'athlete_id', demo)
  wiped.athlete_goals = await deleteWhereEq(admin, 'athlete_goals', 'athlete_id', demo)
  wiped.athlete_constraints = await deleteWhereEq(admin, 'athlete_constraints', 'athlete_id', demo)
  wiped.health_metrics = await deleteWhereEq(admin, 'health_metrics', 'athlete_id', demo)
  wiped.sync_log = await deleteWhereEq(admin, 'sync_log', 'athlete_id', demo)

  // 3. Clone — parents before children, remapping FKs through the id maps.
  const cloned: Record<string, number> = {}

  const goals = await cloneTable(admin, 'athlete_goals', { column: 'athlete_id', eq: source }, { demoAthleteId: demo })
  cloned.athlete_goals = goals.inserted

  const plans = await cloneTable(admin, 'training_plans', { column: 'athlete_id', eq: source },
    { demoAthleteId: demo, remaps: { goal_id: goals.idMap } })
  cloned.training_plans = plans.inserted

  const phases = await cloneTable(admin, 'training_phases', { column: 'plan_id', in: [...plans.idMap.keys()] },
    { demoAthleteId: demo, remaps: { plan_id: plans.idMap } })
  cloned.training_phases = phases.inserted

  const weeks = await cloneTable(admin, 'weekly_plans', { column: 'athlete_id', eq: source },
    { demoAthleteId: demo, remaps: { phase_id: phases.idMap } })
  cloned.weekly_plans = weeks.inserted

  // planned_workouts.completed_activity_id -> activities is deferred (the cycle).
  // The garmin_* fields reference workouts in the OWNER's Garmin account — null them.
  const workouts = await cloneTable(admin, 'planned_workouts', { column: 'athlete_id', eq: source },
    { demoAthleteId: demo, remaps: { weekly_plan_id: weeks.idMap },
      nullColumns: ['completed_activity_id', 'garmin_workout_id', 'garmin_scheduled_at', 'garmin_sync_status'] })
  cloned.planned_workouts = workouts.inserted

  const activities = await cloneTable(admin, 'activities', { column: 'athlete_id', eq: source },
    { demoAthleteId: demo, remaps: { planned_workout_id: workouts.idMap } })
  cloned.activities = activities.inserted

  // Back-fill the deferred cycle ref now that activities exist.
  await backfillCompletedActivity(admin, workouts.sourceRows, workouts.idMap, activities.idMap)

  cloned.laps = (await cloneTable(admin, 'laps', { column: 'activity_id', in: [...activities.idMap.keys()] },
    { demoAthleteId: demo, remaps: { activity_id: activities.idMap } })).inserted

  cloned.workout_feedback = (await cloneTable(admin, 'workout_feedback', { column: 'athlete_id', eq: source },
    { demoAthleteId: demo, remaps: { activity_id: activities.idMap, planned_workout_id: workouts.idMap } })).inserted

  cloned.workout_flags = (await cloneTable(admin, 'workout_flags', { column: 'athlete_id', eq: source },
    { demoAthleteId: demo, remaps: { activity_id: activities.idMap, planned_workout_id: workouts.idMap } })).inserted

  cloned.plan_adjustments = (await cloneTable(admin, 'plan_adjustments', { column: 'athlete_id', eq: source },
    { demoAthleteId: demo, remaps: { original_workout_id: workouts.idMap, weekly_plan_id: weeks.idMap } })).inserted

  cloned.phase_progress = (await cloneTable(admin, 'phase_progress', { column: 'phase_id', in: [...phases.idMap.keys()] },
    { demoAthleteId: demo, remaps: { phase_id: phases.idMap } })).inserted

  const sessions = await cloneTable(admin, 'chat_sessions', { column: 'athlete_id', eq: source },
    { demoAthleteId: demo, remaps: { specific_workout_id: workouts.idMap, weekly_plan_id: weeks.idMap } })
  cloned.chat_sessions = sessions.inserted

  cloned.chat_messages = (await cloneTable(admin, 'chat_messages', { column: 'session_id', in: [...sessions.idMap.keys()] },
    { demoAthleteId: demo, remaps: { session_id: sessions.idMap } })).inserted

  cloned.health_metrics = (await cloneTable(admin, 'health_metrics', { column: 'athlete_id', eq: source },
    { demoAthleteId: demo })).inserted

  cloned.athlete_constraints = (await cloneTable(admin, 'athlete_constraints', { column: 'athlete_id', eq: source },
    { demoAthleteId: demo, nullColumns: ['created_from_chat_id'] })).inserted

  const programs = await cloneTable(admin, 'strength_programs', { column: 'athlete_id', eq: source },
    { demoAthleteId: demo })
  cloned.strength_programs = programs.inserted

  cloned.strength_sessions = (await cloneTable(admin, 'strength_sessions', { column: 'athlete_id', eq: source },
    { demoAthleteId: demo, remaps: { program_id: programs.idMap }, nullColumns: ['garmin_workout_id'] })).inserted

  const imported = await cloneTable(admin, 'imported_run_plans', { column: 'athlete_id', eq: source },
    { demoAthleteId: demo })
  cloned.imported_run_plans = imported.inserted

  cloned.imported_run_plan_applications = (await cloneTable(admin, 'imported_run_plan_applications', { column: 'athlete_id', eq: source },
    { demoAthleteId: demo, remaps: { imported_run_plan_id: imported.idMap, training_plan_id: plans.idMap } })).inserted

  // 4. Overwrite the demo athlete's training profile from the source, preserving
  //    identity and demo/account flags.
  await copyTrainingProfile(admin, source, demo)

  return { wiped, cloned }
}

/** Back-fill planned_workouts.completed_activity_id (deferred during the cycle break). */
async function backfillCompletedActivity(
  admin: SupabaseClient,
  sourceWorkouts: Row[],
  workoutMap: IdMap,
  activityMap: IdMap,
): Promise<void> {
  for (const w of sourceWorkouts) {
    const srcCompleted = w.completed_activity_id
    if (srcCompleted == null) continue
    const demoWorkoutId = workoutMap.get(w.id as number)
    const demoActivityId = activityMap.get(srcCompleted as number)
    if (demoWorkoutId == null || demoActivityId == null) continue
    const { error } = await admin.from('planned_workouts').update({ completed_activity_id: demoActivityId }).eq('id', demoWorkoutId)
    if (error) throw new Error(`backfill completed_activity_id failed: ${error.message}`)
  }
}

/** Fields copied source -> demo; identity and account/demo flags are NOT touched. */
const PROFILE_FIELDS = [
  'date_of_birth', 'gender', 'max_hr', 'resting_hr', 'threshold_pace', 'threshold_power',
  'vo2_max', 'preferred_units', 'week_starts_on', 'timezone',
  'preferred_llm_provider', 'preferred_llm_model', 'preferred_vision_provider', 'preferred_vision_model',
  'use_fast_model_for_operations', 'preferred_activity_data_source', 'vdot', 'training_paces',
  'pace_source', 'pace_source_data', 'ai_summaries_enabled', 'feedback_tone', 'locale',
] as const

async function copyTrainingProfile(admin: SupabaseClient, source: string, demo: string): Promise<void> {
  const { data, error } = await admin.from('athletes').select('*').eq('id', source).single()
  if (error || !data) throw new Error(`read source athlete profile failed: ${error?.message ?? 'not found'}`)
  const src = data as unknown as Row

  const update: Row = {}
  for (const f of PROFILE_FIELDS) update[f] = src[f]
  // The demo account must never advertise a real Garmin/Strava connection.
  update.garmin_connected = false
  update.strava_connected = false
  // Demo summaries never push outward.
  update.push_summary_to_garmin = false
  update.push_summary_to_strava = false

  const { error: updErr } = await admin.from('athletes').update(update).eq('id', demo)
  if (updErr) throw new Error(`copy training profile failed: ${updErr.message}`)
}
