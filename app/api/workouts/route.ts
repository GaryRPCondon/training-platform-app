/**
 * Phase 6: Workouts API
 *
 * GET /api/workouts - Get workouts for a date range (for workout linker)
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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
