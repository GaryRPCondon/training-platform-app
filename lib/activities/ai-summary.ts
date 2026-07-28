/**
 * AI Activity Summary Generator
 *
 * Generates a short coaching summary comparing an activity's actual performance
 * against its matched planned workout. Uses the athlete's preferred LLM provider.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Activity, PlannedWorkout, Lap, TrainingPaces } from '@/types/database'
import { createLLMProvider } from '@/lib/agent/factory'
import { demoProviderOverride } from '@/lib/demo/demo'
import { getIntensityPaceType } from '@/lib/training/vdot'
import { getEffectiveDistance, calculateDistanceDiff, calculateDurationDiff, loadActivePlanPaces } from '@/lib/activities/scoring'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AISummaryResult {
  summary: string
  starRating: number
  model: string
  usage: { inputTokens: number; outputTokens: number }
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export type FeedbackTone = 'critical' | 'balanced' | 'positive'

const TONE_CLAUSES: Record<FeedbackTone, string> = {
  critical: `VOICE = CRITICAL. Open the summary with the biggest shortfall against plan intent — no warm-up phrase, no acknowledgement of strengths first. Be blunt and unsparing. Use language like "missed", "drifted", "too fast", "fell short", "control issue". If the session hit its intent cleanly with no real shortfall, say so plainly and stop — do not invent criticism. Do not soften with phrases like "but overall" or "good effort otherwise".`,
  balanced: `VOICE = BALANCED. Acknowledge what was executed well first, then state what needs improvement. Equal weight to both. Neutral, factual tone.`,
  positive: `VOICE = POSITIVE. Open with what was executed well — name a specific strength (pace control, HR discipline, distance, intent achieved). Mention shortfalls only briefly at the end and frame as "next time" guidance, not failure. Use language like "nailed", "held", "executed", "on target", "carry forward". Never flatter — only reinforce wins that are genuinely in the data.`,
}

export function buildSystemPrompt(tone: FeedbackTone): string {
  return `You are an AI running coach generating a post-activity summary for an endurance athlete.

${TONE_CLAUSES[tone]}

Rules:
- Do not restate stats the athlete already knows (distance, duration, date). Lead with the coaching insight.
- Compare execution to plan intent — was the session's purpose achieved?
- When a target pace range is provided, use it as the ground truth for pace evaluation. Do not guess or assume pace targets.
- All pace and duration data is based on moving time (excluding stopped time). Treat it as the true effort metric.
- Multi-pace sessions (a long run or easy run with embedded tempo/threshold/interval reps) are judged segment by segment. The whole-activity average pace of such a session is an arithmetic blend of easy and work paces — it is NOT a target. NEVER compare the overall average pace against a work-rep target pace, and never call the gap between them a miss or a shortfall. Judge the work reps against the work-rep target, and the easy portions against easy pace, separately.
- When lap elevation data is present, account for terrain: slower uphill laps and faster downhill laps are expected on hilly routes and do not indicate inconsistent effort. Judge effort using HR alongside pace on hilly runs.
- Adherence weighting by run type — THIS IS BINDING:
  - Easy runs / recovery runs / long runs: judge success on average HR and effort control. The easy pace is an upper limit on effort, not a number to hit — running slower than it is never a shortfall, never a miss, and must not lower the rating or be raised as a fault. Running faster than it is the only pace fault available on these runs, because it erodes recovery. Lap-to-lap variance is normal (terrain, HR drift, natural cadence shifts) and is informational only: do NOT downgrade for it, and do NOT call out individual laps unless the run's average pace was itself faster than easy. HR in the easy zone with an average pace at or below easy pace is a 4.5–5.0.
  - Intervals / tempo / threshold / VO2max: per-lap pace compliance is the primary success metric. Lap drift, slow first reps, and fade in final reps matter and should be called out specifically.
  - For intervals/tempo workouts: ONLY active work-rep laps (Role = ACTIVE or INTERVAL) are evaluated against the work-rep target pace. Warmup, cooldown, and recovery laps deliberately run easier than the target and MUST NOT be counted as misses. When the summary mentions pace adherence, name a direction: state whether the work reps were too fast, too slow, or on target. The Adherence% column shows a signed deviation in parentheses (e.g. "95% (3s fast)") — this is the ground truth for direction. A lower adherence % does NOT imply slower; read the parenthetical to know whether a rep was fast or slow. Never assume a "fade" in the final reps unless the deviations actually show the closing reps slowing. Never say "X% of laps in range" without specifying which laps and which direction.
- The evaluation rules above are internal reasoning, not material for the summary. Never restate a rule, never borrow its vocabulary ("ceiling", "upper limit", "within range", "aligns with the intent"), and never report that a rule was satisfied — confirming compliance is not a coaching insight. Write about what the athlete did, in an athlete's words.
- On easy / recovery / long runs, do not mention the easy pace at all unless the athlete actually ran faster than it. A run at or below easy pace needs no pace comment: describe the effort or the aerobic quality instead, or say nothing about pace.
- Be direct and prescriptive: when something needs correcting, say what to do differently.
- Where pace, HR, or effort drifted from target, explain the training consequence (e.g. "running easy days this fast erodes recovery", "the fade in final reps suggests the interval target was too aggressive").
- Use concrete numbers (e.g. "4:15/km", "128 bpm") to support observations, not as the observation itself.
- No generic motivational language or forward-looking statements about races or readiness.
- No speculation about terrain, conditions, or factors not in the data.
- 1-2 sentences maximum. Every word must earn its place.

Rating guidance (0.0–5.0 in 0.5 increments, based on plan intent not just completion):
- 5.0: Nailed it — distance, pace, intensity all on target
- 4.0–4.5: Solid execution with minor deviations
- 3.0–3.5: Completed but meaningful gaps in pace compliance or intensity control
- 2.0–2.5: Significant drift from plan intent (e.g. easy run became tempo, intervals too slow)
- 1.0–1.5: Workout barely resembles the plan
- 0.0–0.5: Did not complete or entirely wrong workout type

Output format — respond ONLY with valid JSON, no markdown, no preamble:
{
  "star_rating": <number 0.0-5.0 in 0.5 increments>,
  "summary": "<1-2 sentence summary>"
}`
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPace(secondsPerKm: number | null): string {
  if (!secondsPerKm || secondsPerKm <= 0) return 'N/A'
  // Round to whole seconds first, then split — rounding the remainder
  // independently produces "4:60/km" when seconds round up to 60.
  const rounded = Math.round(secondsPerKm)
  const mins = Math.floor(rounded / 60)
  const secs = rounded % 60
  return `${mins}:${secs.toString().padStart(2, '0')}/km`
}

// Compact mm:ss for lap durations (e.g. "1:30"). Laps are short enough that
// hours never apply — formatDuration's "1m 30s" style is too wide for a table.
function formatLapDuration(totalSeconds: number | null): string {
  if (!totalSeconds || totalSeconds <= 0) return 'N/A'
  const rounded = Math.round(totalSeconds)
  const mins = Math.floor(rounded / 60)
  const secs = rounded % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function formatDuration(totalSeconds: number | null): string {
  if (!totalSeconds || totalSeconds <= 0) return 'N/A'
  const rounded = Math.round(totalSeconds)
  const h = Math.floor(rounded / 3600)
  const m = Math.floor((rounded % 3600) / 60)
  const s = rounded % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  return `${m}m ${s}s`
}

type WorkoutType = PlannedWorkout['workout_type']

const LOW_INTENSITY_TYPES: ReadonlySet<WorkoutType> = new Set(['easy_run', 'long_run', 'recovery'])

const ACTIVE_LAP_ROLES = new Set(['ACTIVE', 'INTERVAL'])

// Structured-workout interval roles that are not work reps: these deliberately run
// easier than the work-rep target and must never be judged against it.
const RECOVERY_ROLES = new Set(['recovery', 'rest', 'warmup', 'cooldown'])

function isLowIntensity(workoutType: WorkoutType): boolean {
  return LOW_INTENSITY_TYPES.has(workoutType)
}

/**
 * True when a nominally low-intensity workout embeds quality work — e.g. a long run
 * built as 2E + 4 × 1T + 30 min E. Classifying on workout_type alone sent these down
 * the easy-run path, which told the model to judge the session on its whole-activity
 * average pace against the T-pace stamp — guaranteeing a false "you ran too slow".
 * Judged on structure, not type, so a plain long run keeps the overall-pace path.
 */
function segmentMix(workout: PlannedWorkout): { quality: boolean; easy: boolean } {
  const sw = workout.structured_workout as Record<string, unknown> | null
  if (!sw || !Array.isArray(sw.main_set)) return { quality: false, easy: false }

  let quality = false
  let easy = false
  for (const group of sw.main_set as Array<{ intervals?: Array<Record<string, unknown>> }>) {
    for (const iv of group.intervals ?? []) {
      const intensity = typeof iv.intensity === 'string' ? iv.intensity : ''
      if (!intensity) continue
      const role = typeof iv.role === 'string' ? iv.role.toLowerCase() : ''
      if (getIntensityPaceType(intensity) === 'easy') {
        easy = true
      } else if (!RECOVERY_ROLES.has(role)) {
        quality = true
      }
    }
  }
  return { quality, easy }
}

/**
 * How to evaluate the session: 'structured' judges per-lap work-rep compliance,
 * 'overall' judges whole-activity average pace and HR, 'mixed' is a low-intensity
 * session carrying quality reps — per-lap for the reps, overall for the easy parts.
 */
type EvaluationMode = 'structured' | 'overall' | 'mixed'

function resolveEvaluationMode(workout: PlannedWorkout): EvaluationMode {
  if (!isLowIntensity(workout.workout_type)) return 'structured'
  const { quality, easy } = segmentMix(workout)
  if (!quality) return 'overall'
  // Quality work with easy running around it is a genuine blend. Quality work
  // WITHOUT any easy segment — a marathon-pace long run, say — has no blend: its
  // whole-activity average is the target, so 'mixed' would wrongly tell the model to
  // disregard it, and 'overall' would wrongly assert HR should sit in the easy zone.
  return easy ? 'mixed' : 'structured'
}

function lapRole(lap: Lap): string {
  return (lap.intensity_type || '').toUpperCase()
}

function isActiveLap(lap: Lap): boolean {
  return ACTIVE_LAP_ROLES.has(lapRole(lap))
}

type TargetPaceBand = { lower: number; upper: number | null }

/**
 * Describe how an active lap's pace sits relative to the work-rep target band,
 * e.g. "3s fast", "5s slow", "on target". Garmin's compliance_score is a single
 * direction-agnostic number, so without this the LLM guesses the direction from
 * the score (and wrongly reads a low score on the final rep as a fade/slowdown).
 * In sec/km a smaller number is faster.
 */
function activeLapDeviation(paceSecsPerKm: number | null, band: TargetPaceBand): string | null {
  if (!paceSecsPerKm || paceSecsPerKm <= 0) return null
  const slowBound = band.upper ?? band.lower
  if (paceSecsPerKm < band.lower) return `${Math.round(band.lower - paceSecsPerKm)}s fast`
  if (paceSecsPerKm > slowBound) return `${Math.round(paceSecsPerKm - slowBound)}s slow`
  return 'on target'
}

function buildLapTable(laps: Lap[], showAdherence: boolean, targetBand: TargetPaceBand | null): string {
  if (laps.length === 0) return ''

  const header = showAdherence
    ? 'Lap | Distance | Duration | Pace | Avg HR | Max HR | Elev Gain | Role | Adherence% (vs target)'
    : 'Lap | Distance | Duration | Pace | Avg HR | Max HR | Elev Gain | Role'
  const divider = showAdherence
    ? '--- | -------- | -------- | ---- | ------ | ------ | --------- | ---- | ----------------------'
    : '--- | -------- | -------- | ---- | ------ | ------ | --------- | ----'
  const rows = laps.map(lap => {
    const dist = lap.distance_meters ? `${(lap.distance_meters / 1000).toFixed(2)} km` : 'N/A'
    const duration = formatLapDuration(lap.duration_seconds)
    const pace = formatPace(lap.avg_pace)
    const avgHr = lap.avg_hr ? `${lap.avg_hr}` : 'N/A'
    const maxHr = lap.max_hr ? `${lap.max_hr}` : 'N/A'
    const elev = lap.elevation_gain_meters != null ? `${Math.round(lap.elevation_gain_meters)}m` : '-'
    const role = lapRole(lap) || '-'
    const base = `${lap.lap_index} | ${dist} | ${duration} | ${pace} | ${avgHr} | ${maxHr} | ${elev} | ${role}`
    if (!showAdherence) return base
    // Only annotate adherence for active work-rep laps — recovery/warmup/cooldown
    // laps deliberately miss the work-rep pace target and shouldn't be judged on it.
    // Append the signed deviation so the LLM reads direction from data, not the score.
    if (!isActiveLap(lap)) return `${base} | —`
    const score = lap.compliance_score != null ? `${lap.compliance_score}%` : '—'
    const deviation = targetBand ? activeLapDeviation(lap.avg_pace, targetBand) : null
    const cell = deviation ? `${score} (${deviation})` : score
    return `${base} | ${cell}`
  })

  return `\nLap breakdown:\n${header}\n${divider}\n${rows.join('\n')}`
}

/** Parse a "M:SS" or "M:SS-M:SS" pace string into a sec/km band (lower = faster). */
function parsePaceBandString(raw: string): TargetPaceBand | null {
  const parseClock = (token: string): number | null => {
    const parts = token.trim().split('/')[0].split(':')
    if (parts.length !== 2) return null
    const minutes = Number(parts[0])
    const seconds = Number(parts[1])
    if (!Number.isInteger(minutes) || !Number.isInteger(seconds)) return null
    return minutes * 60 + seconds
  }
  const clean = raw.trim()
  const dash = clean.indexOf('-', 1)
  if (dash > 0) {
    const a = parseClock(clean.slice(0, dash))
    const b = parseClock(clean.slice(dash + 1))
    if (a != null && b != null) return { lower: Math.min(a, b), upper: Math.max(a, b) }
    const single = a ?? b
    return single != null ? { lower: single, upper: null } : null
  }
  const single = parseClock(clean)
  return single != null ? { lower: single, upper: null } : null
}

/**
 * Derive a work-rep target band from athlete-specified per-interval `target_pace`
 * strings (custom-pace structured workouts store the pace only as a string, not the
 * numeric target_pace_sec_per_km stamp). Skips intervals tagged as recovery/rest/
 * warmup/cooldown so the band reflects the work reps being evaluated.
 */
function extractStructuredWorkPaceBand(workout: PlannedWorkout): TargetPaceBand | null {
  const sw = workout.structured_workout as Record<string, unknown> | null
  if (!sw) return null
  const mainSetRaw = sw.main_set
  const mainSet: Array<Record<string, unknown>> = Array.isArray(mainSetRaw)
    ? (mainSetRaw as Array<Record<string, unknown>>)
    : mainSetRaw && typeof mainSetRaw === 'object'
      ? [mainSetRaw as Record<string, unknown>]
      : []

  for (const entry of mainSet) {
    const intervals = Array.isArray(entry.intervals)
      ? (entry.intervals as Array<Record<string, unknown>>)
      : typeof entry.target_pace === 'string'
        ? [entry]
        : []
    for (const iv of intervals) {
      if (typeof iv.target_pace !== 'string') continue
      const role = typeof iv.role === 'string' ? iv.role.toLowerCase() : ''
      if (RECOVERY_ROLES.has(role)) continue
      const band = parsePaceBandString(iv.target_pace)
      if (band) return band
    }
  }
  return null
}

/**
 * Resolve the workout's target pace band. Order: numeric stamp (plan generation /
 * athlete override) → custom per-interval pace on structured work reps → custom
 * top-level pace on a simple workout.
 */
function resolveTargetPaceBand(workout: PlannedWorkout): TargetPaceBand | null {
  const sw = workout.structured_workout as Record<string, unknown> | null
  if (!sw) return null

  const lower = sw.target_pace_sec_per_km as number | undefined
  if (lower) {
    const upper = sw.target_pace_upper_sec_per_km as number | undefined
    return { lower, upper: upper ?? null }
  }

  const structuredBand = extractStructuredWorkPaceBand(workout)
  if (structuredBand) return structuredBand

  if (typeof sw.target_pace === 'string') {
    return parsePaceBandString(sw.target_pace)
  }
  return null
}

function extractTargetPaceBand(workout: PlannedWorkout): TargetPaceBand | null {
  return resolveTargetPaceBand(workout)
}

function extractTargetPace(workout: PlannedWorkout): string {
  const band = resolveTargetPaceBand(workout)
  if (!band) return 'N/A'
  if (band.upper != null && band.upper !== band.lower) {
    return `${formatPace(band.lower)} – ${formatPace(band.upper)}`
  }
  return formatPace(band.lower)
}

type StructuredPart = {
  role?: string
  duration_minutes?: number
  duration_seconds?: number
  distance_meters?: number
  intensity?: string
  target_pace?: string
}

type MainSetEntry = { repeat?: number; intervals?: StructuredPart[] }

/** The workout's generation-time pace stamp, with the intensity it was resolved for. */
type StampedPace = { paceType: keyof TrainingPaces; secPerKm: number } | null

function extractStampedPace(workout: PlannedWorkout): StampedPace {
  const sw = workout.structured_workout as Record<string, unknown> | null
  const secPerKm = sw?.target_pace_sec_per_km
  const label = sw?.pace_label
  if (typeof secPerKm !== 'number' || typeof label !== 'string') return null
  return { paceType: getIntensityPaceType(label), secPerKm }
}

/**
 * The pace this segment was prescribed at. An athlete-specified custom pace wins;
 * then the workout's own generation-time stamp when the segment shares its intensity;
 * then the plan's current VDOT paces.
 *
 * The stamp has to win over live paces, or the structure block and the "Target pace"
 * line disagree for the same segment whenever VDOT has moved without a re-pace run —
 * they already differ in live data (a workout stamped at 305 sec/km inside a plan
 * whose easy pace is now 309). Showing both invites the model to explain a gap that
 * does not exist.
 */
function partPaceSuffix(
  part: StructuredPart,
  trainingPaces: TrainingPaces | null,
  stamped: StampedPace = null,
): string {
  if (part.target_pace) return ` (${part.target_pace})`
  if ((part.role ?? '').toLowerCase() === 'rest') return ''
  if (!part.intensity) return ''
  const paceType = getIntensityPaceType(part.intensity)
  if (stamped && stamped.paceType === paceType) return ` (${formatPace(stamped.secPerKm)})`
  const pace = trainingPaces?.[paceType]
  return pace ? ` (${formatPace(pace)})` : ''
}

function formatStructuredPart(
  part: StructuredPart,
  trainingPaces: TrainingPaces | null = null,
  stamped: StampedPace = null,
): string {
  const intensity = part.intensity || 'unspecified'
  const paceSuffix = partPaceSuffix(part, trainingPaces, stamped)
  if (part.distance_meters) {
    const km = part.distance_meters / 1000
    const dist = km >= 1 ? `${km.toFixed(km >= 10 ? 1 : 2)} km` : `${part.distance_meters} m`
    return `${dist} @ ${intensity}${paceSuffix}`
  }
  if (part.duration_minutes) return `${part.duration_minutes} min @ ${intensity}${paceSuffix}`
  if (part.duration_seconds) {
    const base = part.duration_seconds >= 60 && part.duration_seconds % 60 === 0
      ? `${part.duration_seconds / 60} min @ ${intensity}`
      : `${part.duration_seconds} s @ ${intensity}`
    return `${base}${paceSuffix}`
  }
  return `(open) @ ${intensity}${paceSuffix}`
}

function formatMainSetEntry(
  entry: MainSetEntry,
  trainingPaces: TrainingPaces | null,
  stamped: StampedPace,
): string | null {
  const intervals = entry.intervals
  if (!Array.isArray(intervals) || intervals.length === 0) return null
  const inner = intervals.map(p => formatStructuredPart(p, trainingPaces, stamped)).join(' + ')
  const repeat = entry.repeat ?? 1
  if (repeat === 1 && intervals.length === 1) return inner
  return `${repeat} × (${inner})`
}

/**
 * Render a compact summary of the planned structure (warmup / main_set / cooldown)
 * so the LLM can see what each lap segment was *supposed* to do. Returns null when
 * the workout has no main_set (simple workouts — no value in adding noise).
 */
function buildStructureBlock(workout: PlannedWorkout, trainingPaces: TrainingPaces | null): string | null {
  const sw = workout.structured_workout as Record<string, unknown> | null
  if (!sw) return null
  const mainSetRaw = sw.main_set
  const mainSet: MainSetEntry[] = Array.isArray(mainSetRaw)
    ? (mainSetRaw as MainSetEntry[])
    : mainSetRaw && typeof mainSetRaw === 'object'
      ? [mainSetRaw as MainSetEntry]
      : []
  if (mainSet.length === 0) return null

  const lines: string[] = ['Workout structure (each segment with its own prescribed pace):']
  const warmup = sw.warmup as StructuredPart | undefined
  const stamped = extractStampedPace(workout)
  if (warmup) lines.push(`  Warmup: ${formatStructuredPart(warmup, trainingPaces, stamped)}`)
  const mainLines = mainSet
    .map(entry => formatMainSetEntry(entry, trainingPaces, stamped))
    .filter((s): s is string => s !== null)
  if (mainLines.length > 0) lines.push(`  Main set: ${mainLines.join('; ')}`)
  const cooldown = sw.cooldown as StructuredPart | undefined
  if (cooldown) lines.push(`  Cooldown: ${formatStructuredPart(cooldown, trainingPaces, stamped)}`)
  return lines.length > 1 ? lines.join('\n') : null
}

export function buildUserMessage(
  activity: Activity,
  workout: PlannedWorkout,
  laps: Lap[],
  trainingPaces: TrainingPaces | null = null,
): string {
  const effectiveDistance = getEffectiveDistance(workout, trainingPaces)
  const distanceVariance = calculateDistanceDiff(activity.distance_meters, effectiveDistance)
  const durationVariance = calculateDurationDiff(activity.duration_seconds, workout.duration_target_seconds)

  // Use moving time for pace calculation (falls back to elapsed time)
  const movingSeconds = activity.moving_duration_seconds ?? activity.duration_seconds
  const avgPaceSecsPerKm = activity.distance_meters && movingSeconds && activity.distance_meters > 0
    ? (movingSeconds / (activity.distance_meters / 1000))
    : null

  const mode = resolveEvaluationMode(workout)
  // 'mixed' carries quality reps, so it uses the per-lap machinery like a structured
  // workout — only 'overall' (a plain easy/long/recovery run) judges on the average.
  const overallOnly = mode === 'overall'

  // Pace compliance headline: for intervals/tempo/threshold, average only ACTIVE
  // work-rep laps so the headline isn't diluted by warmup/recovery/cooldown laps
  // that targeted a different (easier) pace. Falls back to all laps if no lap is
  // tagged ACTIVE/INTERVAL (older activities or non-Garmin sources).
  const lapsForCompliance = overallOnly
    ? laps.filter(l => l.compliance_score != null)
    : (() => {
        const active = laps.filter(l => isActiveLap(l) && l.compliance_score != null)
        return active.length > 0 ? active : laps.filter(l => l.compliance_score != null)
      })()
  const paceCompliancePct = lapsForCompliance.length > 0
    ? Math.round(lapsForCompliance.reduce((sum, l) => sum + l.compliance_score!, 0) / lapsForCompliance.length)
    : null
  const complianceLabel = !overallOnly && lapsForCompliance.some(isActiveLap)
    ? 'Active-rep pace compliance'
    : 'Pace compliance'

  const targetPace = extractTargetPace(workout)
  // Naming it a "target" on an easy run invited the model to treat any slower pace as
  // a miss (a 5:38/km run at 115 bpm was reported as having "drifted significantly
  // slower than the target"). It is an upper bound on effort, so label it as one —
  // but keep the label plain: a quotable phrase here gets parroted into the summary
  // ("the overall pace was slower than the easy pace ceiling"). The criteria block
  // carries the semantics; this line only has to avoid the word "target".
  const targetPaceLabel = overallOnly
    ? 'Easy pace (upper limit)'
    : 'Target pace (work reps only)'
  const structureBlock = buildStructureBlock(workout, trainingPaces)

  const workoutTypeLabel = workout.workout_type.replace('_', ' ')
  const primaryMetric = {
    overall: `PRIMARY EVALUATION CRITERIA — this is a ${workoutTypeLabel}: judge success on overall average HR and effort control. The easy pace below is an upper limit, not a target: running slower than it is not a shortfall and must not be criticised or rated down. Running faster than it is the fault to call out, because it erodes recovery. Lap-to-lap pace variance is informational only and MUST NOT lower the rating. If average HR sits in the easy zone and the average pace was not faster than the easy pace, rate this 4.5–5.0 and leave pace out of the summary entirely — do not report that the pace was acceptable, and do not name individual laps.`,
    structured: `PRIMARY EVALUATION CRITERIA — this is a ${workoutTypeLabel}: judge success on per-lap pace compliance and intensity control. ONLY laps with Role = ACTIVE or INTERVAL are evaluated against the work-rep target pace. Warmup, cooldown, and recovery laps run at easier paces by design — do not count them as misses. When commenting on pace, state direction explicitly: too fast, too slow, or on target.`,
    mixed: `PRIMARY EVALUATION CRITERIA — this is a ${workoutTypeLabel} with embedded quality segments, so it is a MULTI-PACE session. Judge it segment by segment: (a) the work reps — ONLY laps with Role = ACTIVE or INTERVAL — against the work-rep target pace below, and (b) the easy/recovery portions against easy pace. The whole-activity average pace blends both and is NOT a target: do NOT compare it to the work-rep target pace and do NOT treat the gap between them as a shortfall. Warmup, cooldown, rest, and recovery laps run easier by design — never count them as misses. When commenting on pace, state direction explicitly: too fast, too slow, or on target.`,
  }[mode]

  let msg = `${primaryMetric}

Planned workout:
- Type: ${workout.workout_type}
- Target distance: ${effectiveDistance ? `${(effectiveDistance / 1000).toFixed(2)} km` : 'N/A'}
- Target duration: ${workout.duration_target_seconds ? formatDuration(workout.duration_target_seconds) : 'N/A'}
- Intensity: ${workout.intensity_target || 'N/A'}
- ${targetPaceLabel}: ${targetPace}
- Description: ${workout.description || 'N/A'}`

  if (structureBlock) {
    msg += `\n${structureBlock}`
  }

  msg += `

Actual activity:
- Distance: ${activity.distance_meters ? `${(activity.distance_meters / 1000).toFixed(2)} km` : 'N/A'}
- Moving time: ${formatDuration(movingSeconds)}
- Average moving pace: ${formatPace(avgPaceSecsPerKm)}${mode === 'mixed' ? ' (blend of easy and work segments — not a target, do not compare to the work-rep pace)' : ''}
- Average HR: ${activity.avg_hr ? `${activity.avg_hr} bpm` : 'N/A'}
- Max HR: ${activity.max_hr ? `${activity.max_hr} bpm` : 'N/A'}
- Distance variance vs plan: ${distanceVariance !== 0 ? `${distanceVariance > 0 ? '+' : ''}${distanceVariance.toFixed(1)}%` : '0%'}
- Duration variance vs plan: ${durationVariance !== 0 ? `${durationVariance > 0 ? '+' : ''}${durationVariance.toFixed(1)}%` : '0%'}`

  if (paceCompliancePct != null && !overallOnly) {
    msg += `\n- ${complianceLabel}: ${paceCompliancePct}%`
  }

  const targetBand = overallOnly ? null : extractTargetPaceBand(workout)
  const lapTable = buildLapTable(laps, !overallOnly, targetBand)
  if (lapTable) {
    msg += `\n${lapTable}`
  }

  msg += '\n\nGenerate the star rating and summary.'
  return msg
}

function parseResponse(content: string): { star_rating: number; summary: string } | null {
  try {
    // Strip markdown code fences if present
    const cleaned = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const parsed = JSON.parse(cleaned)

    if (typeof parsed.star_rating !== 'number' || typeof parsed.summary !== 'string') {
      return null
    }

    // Snap to nearest 0.5
    const snapped = Math.round(parsed.star_rating * 2) / 2
    const clamped = Math.max(0, Math.min(5, snapped))

    return { star_rating: clamped, summary: parsed.summary.trim() }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function generateActivitySummary(
  supabase: SupabaseClient,
  activityId: number,
): Promise<AISummaryResult | null> {
  // Mark as pending
  await supabase
    .from('activities')
    .update({ ai_summary_status: 'pending' })
    .eq('id', activityId)

  try {
    // Fetch activity
    const { data: activity } = await supabase
      .from('activities')
      .select('*')
      .eq('id', activityId)
      .single()

    if (!activity || !activity.planned_workout_id) {
      console.warn(`[AI Summary] Activity ${activityId} has no planned workout — skipping`)
      await supabase
        .from('activities')
        .update({ ai_summary_status: 'none' })
        .eq('id', activityId)
      return null
    }

    // Fetch planned workout
    const { data: workout } = await supabase
      .from('planned_workouts')
      .select('*')
      .eq('id', activity.planned_workout_id)
      .single()

    if (!workout) {
      console.warn(`[AI Summary] Planned workout ${activity.planned_workout_id} not found — skipping`)
      await supabase
        .from('activities')
        .update({ ai_summary_status: 'failed' })
        .eq('id', activityId)
      return null
    }

    // Fetch laps
    const { data: laps } = await supabase
      .from('laps')
      .select('lap_index, distance_meters, duration_seconds, avg_hr, max_hr, avg_pace, elevation_gain_meters, intensity_type, split_type, compliance_score')
      .eq('activity_id', activityId)
      .order('lap_index', { ascending: true })

    // Fetch athlete for LLM preference and feedback tone
    const { data: athlete } = await supabase
      .from('athletes')
      .select('preferred_llm_provider, preferred_llm_model, feedback_tone')
      .eq('id', activity.athlete_id)
      .single()

    if (!athlete) {
      console.error(`[AI Summary] Athlete ${activity.athlete_id} not found`)
      await supabase
        .from('activities')
        .update({ ai_summary_status: 'failed' })
        .eq('id', activityId)
      return null
    }

    // Build prompt and call LLM
    const tone: FeedbackTone = (athlete.feedback_tone as FeedbackTone | null | undefined) ?? 'balanced'
    const systemPrompt = buildSystemPrompt(tone)
    console.log(`[AI Summary] Activity ${activityId} — tone="${tone}" (athlete ${activity.athlete_id})`)
    const trainingPaces = await loadActivePlanPaces(supabase, activity.athlete_id)
    const userMessage = buildUserMessage(activity, workout, (laps || []) as Lap[], trainingPaces)
    // Demo account: pin the cheap provider regardless of stored preference.
    const demoOverride = demoProviderOverride(activity.athlete_id)
    // For summaries, use Flash Lite when Gemini is selected — summarisation doesn't need thinking mode
    const summaryProvider = demoOverride ? demoOverride.providerName : athlete.preferred_llm_provider
    const summaryModel = demoOverride
      ? demoOverride.modelName
      : (athlete.preferred_llm_provider === 'gemini' && !athlete.preferred_llm_model)
        ? 'gemini-2.5-flash-lite'
        : (athlete.preferred_llm_model ?? undefined)
    const provider = createLLMProvider(summaryProvider, summaryModel)

    // Use two-message pattern: system instructions as first user message,
    // then a model ack, then the actual request. This avoids Gemini's
    // chat history issue where a single user message gets duplicated.
    const llmRequest = {
      messages: [
        { role: 'user' as const, content: `Instructions:\n${systemPrompt}` },
        { role: 'assistant' as const, content: 'Understood. Send me the workout data and I will respond with the JSON rating and summary.' },
        { role: 'user' as const, content: userMessage },
      ],
      maxTokens: 8192,
      temperature: 0.3,
      // JSON rating + summary — non-thinking keeps output within budget and fast.
      disableThinking: true,
    }

    const response = await provider.generateResponse(llmRequest)

    console.log(`[AI Summary] LLM response for activity ${activityId} (${response.model}, ${response.usage.outputTokens} tokens):`, response.content)

    const parsed = parseResponse(response.content)
    if (!parsed) {
      console.error(`[AI Summary] Failed to parse LLM response for activity ${activityId}:`, response.content)
      await supabase
        .from('activities')
        .update({ ai_summary_status: 'failed' })
        .eq('id', activityId)
      return null
    }

    // Store result
    await supabase
      .from('activities')
      .update({
        ai_summary: parsed.summary,
        ai_star_rating: parsed.star_rating,
        ai_summary_status: 'generated',
        ai_summary_generated_at: new Date().toISOString(),
      })
      .eq('id', activityId)

    return {
      summary: parsed.summary,
      starRating: parsed.star_rating,
      model: response.model,
      usage: response.usage,
    }
  } catch (error) {
    console.error(`[AI Summary] Generation failed for activity ${activityId}:`, error)
    await supabase
      .from('activities')
      .update({ ai_summary_status: 'failed' })
      .eq('id', activityId)
    return null
  }
}
