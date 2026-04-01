/**
 * Phase 6: Workouts API
 *
 * GET    /api/workouts?startDate=&endDate= - Get workouts for a date range
 * POST   /api/workouts                     - Create a new planned workout
 * DELETE /api/workouts?id=                 - Delete a planned workout by ID
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { calculateTotalWorkoutDistance } from '@/lib/training/vdot'
import { z } from 'zod'

const createWorkoutSchema = z.object({
  scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  workout_type: z.string().min(1),
  description: z.string().nullable().optional(),
  distance_target_meters: z.number().nonnegative().nullable().optional(),
  duration_target_seconds: z.number().nonnegative().nullable().optional(),
  intensity_target: z.string().nullable().optional(),
  structured_workout: z.record(z.string(), z.unknown()).nullable().optional(),
  target_pace_sec_per_km: z.number().positive().nullable().optional(),
  target_pace_min_sec_per_km: z.number().positive().nullable().optional(),
  target_pace_max_sec_per_km: z.number().positive().nullable().optional(),
})

export async function POST(request: Request) {
  try {
    const rawBody = await request.json()
    const parsed = createWorkoutSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const {
      scheduled_date,
      workout_type,
      description,
      distance_target_meters,
      duration_target_seconds,
      intensity_target,
      structured_workout,
      target_pace_sec_per_km,
      target_pace_min_sec_per_km,
      target_pace_max_sec_per_km,
    } = parsed.data

    // If distance_target_meters is missing but structured_workout has distance data,
    // derive it so the field is always populated for display and weekly totals.
    let resolvedDistance = distance_target_meters || null
    if (!resolvedDistance && structured_workout && workout_type) {
      const computed = calculateTotalWorkoutDistance(null, workout_type, structured_workout, null)
      if (computed > 0) resolvedDistance = computed
    }

    // Stamp athlete pace overrides onto structured_workout if provided
    let resolvedSw = structured_workout || null
    if (target_pace_sec_per_km || target_pace_min_sec_per_km) {
      const paceTarget = target_pace_sec_per_km ?? target_pace_min_sec_per_km!
      const paceUpper = target_pace_max_sec_per_km ?? null
      const fmtP = (s: number) => `${Math.floor(s / 60)}:${Math.round(s % 60).toString().padStart(2, '0')}/km`
      const paceDesc = paceUpper
        ? `Athlete-specified: ${fmtP(paceTarget)}-${fmtP(paceUpper)}`
        : `Athlete-specified: ${fmtP(paceTarget)}`
      resolvedSw = {
        ...(resolvedSw ?? {}),
        target_pace_sec_per_km: paceTarget,
        target_pace_upper_sec_per_km: paceUpper,
        pace_source: 'athlete_override',
        pace_description: paceDesc,
      }
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: workout, error } = await supabase
      .from('planned_workouts')
      .insert({
        athlete_id: user.id,
        scheduled_date,
        workout_type,
        description: description || null,
        distance_target_meters: resolvedDistance,
        duration_target_seconds: duration_target_seconds || null,
        intensity_target: intensity_target || null,
        structured_workout: resolvedSw,
        status: 'scheduled',
        completion_status: 'pending',
        version: 1,
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ workout })
  } catch (error) {
    console.error('Workout create error:', error)
    return NextResponse.json({ error: 'Failed to create workout' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id || isNaN(parseInt(id))) {
      return NextResponse.json({ error: 'Valid workout id is required' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { error } = await supabase
      .from('planned_workouts')
      .delete()
      .eq('id', parseInt(id))
      .eq('athlete_id', user.id)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Workout delete error:', error)
    return NextResponse.json({ error: 'Failed to delete workout' }, { status: 500 })
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: 'startDate and endDate are required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: workouts, error } = await supabase
      .from('planned_workouts')
      .select('*')
      .eq('athlete_id', user.id)
      .gte('scheduled_date', startDate)
      .lte('scheduled_date', endDate)
      .order('scheduled_date', { ascending: true })

    if (error) throw error

    return NextResponse.json(workouts)
  } catch (error) {
    console.error('Workouts fetch error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch workouts' },
      { status: 500 }
    )
  }
}
