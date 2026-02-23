/**
 * Phase 6: Workouts API
 *
 * GET    /api/workouts?startDate=&endDate= - Get workouts for a date range
 * POST   /api/workouts                     - Create a new planned workout
 * DELETE /api/workouts?id=                 - Delete a planned workout by ID
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const {
      scheduled_date,
      workout_type,
      description,
      distance_target_meters,
      duration_target_seconds,
      intensity_target,
      structured_workout,
    } = body

    if (!scheduled_date || !workout_type) {
      return NextResponse.json({ error: 'scheduled_date and workout_type are required' }, { status: 400 })
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
        distance_target_meters: distance_target_meters || null,
        duration_target_seconds: duration_target_seconds || null,
        intensity_target: intensity_target || null,
        structured_workout: structured_workout || null,
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
