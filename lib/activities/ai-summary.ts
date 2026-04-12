/**
 * AI Activity Summary Generator
 *
 * Generates a short coaching summary comparing an activity's actual performance
 * against its matched planned workout. Uses the athlete's preferred LLM provider.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Activity, PlannedWorkout, Lap } from '@/types/database'
import { createLLMProvider } from '@/lib/agent/factory'
import { getEffectiveDistance, calculateDistanceDiff, calculateDurationDiff } from '@/lib/activities/scoring'

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

const SYSTEM_PROMPT = `You are an AI running coach generating a post-activity summary for an endurance athlete.

Rules:
- Do not restate stats the athlete already knows (distance, duration, date). Lead with the coaching insight.
- Compare execution to plan intent — was the session's purpose achieved?
- When a target pace range is provided, use it as the ground truth for pace evaluation. Do not guess or assume pace targets.
- All pace and duration data is based on moving time (excluding stopped time). Treat it as the true effort metric.
- When lap elevation data is present, account for terrain: slower uphill laps and faster downhill laps are expected on hilly routes and do not indicate inconsistent effort. Judge effort using HR alongside pace on hilly runs.
- Acknowledge what was executed well before addressing what needs improvement. Both matter.
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPace(secondsPerKm: number | null): string {
  if (!secondsPerKm || secondsPerKm <= 0) return 'N/A'
  const mins = Math.floor(secondsPerKm / 60)
  const secs = Math.round(secondsPerKm % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}/km`
}

function formatDuration(totalSeconds: number | null): string {
  if (!totalSeconds || totalSeconds <= 0) return 'N/A'
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = Math.round(totalSeconds % 60)
  if (h > 0) return `${h}h ${m}m ${s}s`
  return `${m}m ${s}s`
}

function buildLapTable(laps: Lap[]): string {
  if (laps.length === 0) return ''

  const header = 'Lap | Distance | Pace | Avg HR | Max HR | Elev Gain | Type | Adherence%'
  const divider = '--- | -------- | ---- | ------ | ------ | --------- | ---- | ----------'
  const rows = laps.map(lap => {
    const dist = lap.distance_meters ? `${(lap.distance_meters / 1000).toFixed(2)} km` : 'N/A'
    const pace = formatPace(lap.avg_pace)
    const avgHr = lap.avg_hr ? `${lap.avg_hr}` : 'N/A'
    const maxHr = lap.max_hr ? `${lap.max_hr}` : 'N/A'
    const elev = lap.elevation_gain_meters != null ? `${Math.round(lap.elevation_gain_meters)}m` : '-'
    const type = lap.intensity_type || lap.split_type || '-'
    const adherence = lap.compliance_score != null ? `${lap.compliance_score}%` : 'N/A'
    return `${lap.lap_index} | ${dist} | ${pace} | ${avgHr} | ${maxHr} | ${elev} | ${type} | ${adherence}`
  })

  return `\nLap breakdown:\n${header}\n${divider}\n${rows.join('\n')}`
}

function extractTargetPace(workout: PlannedWorkout): string {
  const sw = workout.structured_workout as Record<string, unknown> | null
  if (!sw) return 'N/A'

  const lower = sw.target_pace_sec_per_km as number | undefined
  const upper = sw.target_pace_upper_sec_per_km as number | undefined
  if (!lower) return 'N/A'

  if (upper) {
    return `${formatPace(lower)} – ${formatPace(upper)}`
  }
  return formatPace(lower)
}

function buildUserMessage(
  activity: Activity,
  workout: PlannedWorkout,
  laps: Lap[],
): string {
  const effectiveDistance = getEffectiveDistance(workout)
  const distanceVariance = calculateDistanceDiff(activity.distance_meters, effectiveDistance)
  const durationVariance = calculateDurationDiff(activity.duration_seconds, workout.duration_target_seconds)

  // Use moving time for pace calculation (falls back to elapsed time)
  const movingSeconds = activity.moving_duration_seconds ?? activity.duration_seconds
  const avgPaceSecsPerKm = activity.distance_meters && movingSeconds && activity.distance_meters > 0
    ? (movingSeconds / (activity.distance_meters / 1000))
    : null

  // Calculate pace compliance from lap compliance scores
  const lapsWithCompliance = laps.filter(l => l.compliance_score != null)
  const paceCompliancePct = lapsWithCompliance.length > 0
    ? Math.round(lapsWithCompliance.reduce((sum, l) => sum + l.compliance_score!, 0) / lapsWithCompliance.length)
    : null

  const targetPace = extractTargetPace(workout)

  let msg = `Planned workout:
- Type: ${workout.workout_type}
- Target distance: ${effectiveDistance ? `${(effectiveDistance / 1000).toFixed(2)} km` : 'N/A'}
- Target duration: ${workout.duration_target_seconds ? formatDuration(workout.duration_target_seconds) : 'N/A'}
- Intensity: ${workout.intensity_target || 'N/A'}
- Target pace: ${targetPace}
- Description: ${workout.description || 'N/A'}

Actual activity:
- Distance: ${activity.distance_meters ? `${(activity.distance_meters / 1000).toFixed(2)} km` : 'N/A'}
- Moving time: ${formatDuration(movingSeconds)}
- Average moving pace: ${formatPace(avgPaceSecsPerKm)}
- Average HR: ${activity.avg_hr ? `${activity.avg_hr} bpm` : 'N/A'}
- Max HR: ${activity.max_hr ? `${activity.max_hr} bpm` : 'N/A'}
- Distance variance vs plan: ${distanceVariance !== 0 ? `${distanceVariance > 0 ? '+' : ''}${distanceVariance.toFixed(1)}%` : '0%'}
- Duration variance vs plan: ${durationVariance !== 0 ? `${durationVariance > 0 ? '+' : ''}${durationVariance.toFixed(1)}%` : '0%'}`

  if (paceCompliancePct != null) {
    msg += `\n- Pace compliance: ${paceCompliancePct}%`
  }

  const lapTable = buildLapTable(laps)
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

    // Fetch athlete for LLM preference
    const { data: athlete } = await supabase
      .from('athletes')
      .select('preferred_llm_provider, preferred_llm_model')
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
    const userMessage = buildUserMessage(activity, workout, (laps || []) as Lap[])
    const provider = createLLMProvider(athlete.preferred_llm_provider, athlete.preferred_llm_model ?? undefined)

    // Use two-message pattern: system instructions as first user message,
    // then a model ack, then the actual request. This avoids Gemini's
    // chat history issue where a single user message gets duplicated.
    const llmRequest = {
      messages: [
        { role: 'user' as const, content: `Instructions:\n${SYSTEM_PROMPT}` },
        { role: 'assistant' as const, content: 'Understood. Send me the workout data and I will respond with the JSON rating and summary.' },
        { role: 'user' as const, content: userMessage },
      ],
      maxTokens: 8192,
      temperature: 0.3,
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
