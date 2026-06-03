import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  placeSessionsWithLLM,
  placeStrengthSessionsWeekAware,
  hasWeekStructure,
  SchedulingFailedError,
} from '@/lib/strength/scheduler'
import { scheduleRequestSchema } from '@/lib/strength/schemas'

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = scheduleRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Pull the athlete's planned workouts in a generous window around the
  // scheduling range so the LLM can see context. Window math is determined
  // by the scheduler itself, so we over-fetch by ±30 days here.
  const templateSessions = parsed.data.parsedProgram.sessions.length
  const startDate = parsed.data.startDate
  const dayMs = 86_400_000
  const startMs = Date.parse(startDate + 'T00:00:00Z')
  // Worst-case span: weekly mode runs templateSessions × weeksToRepeat sessions over
  // weeksToRepeat weeks; fixed mode runs templateSessions sessions ~3 days apart.
  const spanDays = parsed.data.programType === 'weekly'
    ? (parsed.data.weeksToRepeat ?? 1) * 7
    : templateSessions * 3
  const windowMin = new Date(startMs - 30 * dayMs).toISOString().slice(0, 10)
  const windowMax = new Date(startMs + (spanDays + 30) * dayMs).toISOString().slice(0, 10)

  const { data: plannedWorkouts, error: pwErr } = await supabase
    .from('planned_workouts')
    .select('scheduled_date, workout_type, description')
    .eq('athlete_id', user.id)
    .gte('scheduled_date', windowMin)
    .lte('scheduled_date', windowMax)
    .order('scheduled_date', { ascending: true })
  if (pwErr) {
    console.error('Failed to load planned workouts for scheduling:', pwErr)
    return NextResponse.json({ error: 'Failed to load training context' }, { status: 500 })
  }

  const { data: athlete } = await supabase
    .from('athletes')
    .select('preferred_llm_provider, preferred_llm_model')
    .eq('id', user.id)
    .single()

  // Fixed programs whose sessions carry week structure use the deterministic
  // week- and load-aware engine — no LLM, no drift, policy applied by rule.
  // Weekly programs and legacy free-form imports (no week_index) still use the
  // LLM placement path below.
  if (parsed.data.programType === 'fixed' && hasWeekStructure(parsed.data.parsedProgram.sessions)) {
    try {
      const placements = placeStrengthSessionsWeekAware(
        parsed.data.parsedProgram.sessions,
        parsed.data.startDate,
        plannedWorkouts ?? [],
      )
      return NextResponse.json({ placements })
    } catch (err) {
      if (err instanceof SchedulingFailedError) {
        return NextResponse.json({ error: err.message, details: err.details }, { status: 422 })
      }
      console.error('Strength deterministic scheduling error:', err)
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Scheduling failed' },
        { status: 500 },
      )
    }
  }

  // Placement is a structured tool call (thinking already disabled on the
  // forced-tool path); Flash Lite is the cheaper choice when Gemini is
  // selected with no explicit model. Mirrors the parse route.
  const scheduleModel = (athlete?.preferred_llm_provider === 'gemini' && !athlete?.preferred_llm_model)
    ? 'gemini-2.5-flash-lite'
    : (athlete?.preferred_llm_model ?? undefined)

  try {
    const placements = await placeSessionsWithLLM({
      parsedProgram: parsed.data.parsedProgram,
      startDate: parsed.data.startDate,
      programType: parsed.data.programType,
      weeksToRepeat: parsed.data.weeksToRepeat,
      plannedWorkouts: plannedWorkouts ?? [],
      providerName: athlete?.preferred_llm_provider ?? undefined,
      modelName: scheduleModel,
    })

    return NextResponse.json({ placements })
  } catch (err) {
    if (err instanceof SchedulingFailedError) {
      return NextResponse.json(
        { error: err.message, details: err.details },
        { status: 422 },
      )
    }
    console.error('Strength schedule error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Scheduling failed' },
      { status: 500 },
    )
  }
}
