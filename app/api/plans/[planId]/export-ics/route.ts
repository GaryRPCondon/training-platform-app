import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateICS } from '@/lib/plans/ics-export'
import type { ICSWorkout } from '@/lib/plans/ics-export'

interface RouteContext {
  params: Promise<{ planId: string }>
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { planId } = await context.params
    const planIdNum = parseInt(planId, 10)

    if (isNaN(planIdNum)) {
      return NextResponse.json({ error: 'Invalid plan ID' }, { status: 400 })
    }

    const supabase = await createClient()

    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Fetch plan with phases
    const { data: plan, error: planError } = await supabase
      .from('training_plans')
      .select(`
        id,
        name,
        athlete_id,
        training_paces,
        training_phases (
          id
        )
      `)
      .eq('id', planIdNum)
      .single()

    if (planError || !plan) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    }

    if (plan.athlete_id !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const phaseIds = (plan.training_phases as any[]).map(p => p.id)

    if (phaseIds.length === 0) {
      return NextResponse.json({ error: 'Plan has no phases' }, { status: 400 })
    }

    // Fetch weekly plans with nested workouts
    const { data: weeklyPlans, error: weeksError } = await supabase
      .from('weekly_plans')
      .select(`
        planned_workouts (
          id,
          scheduled_date,
          workout_type,
          description,
          distance_target_meters,
          duration_target_seconds,
          intensity_target,
          structured_workout,
          status,
          version
        )
      `)
      .eq('athlete_id', user.id)
      .in('phase_id', phaseIds)

    if (weeksError) {
      console.error('Error fetching workouts for ICS export:', weeksError)
      return NextResponse.json({ error: 'Failed to load workouts' }, { status: 500 })
    }

    // Flatten nested structure into a flat array of workouts
    const workouts: ICSWorkout[] = (weeklyPlans || []).flatMap(
      week => (week.planned_workouts as any[]) || []
    )

    // Get athlete preferred units
    const { data: athlete } = await supabase
      .from('athletes')
      .select('preferred_units')
      .eq('id', user.id)
      .single()

    const units = athlete?.preferred_units ?? 'metric'

    const icsContent = generateICS({
      planName: plan.name || 'Training Plan',
      workouts,
      trainingPaces: plan.training_paces as any,
      units,
    })

    // Sanitize plan name for filename
    const safeName = (plan.name || 'Training_Plan')
      .replace(/[^a-zA-Z0-9_\- ]/g, '')
      .replace(/\s+/g, '_')

    return new Response(icsContent, {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="${safeName}.ics"`,
      },
    })
  } catch (error) {
    console.error('Error in GET /api/plans/[planId]/export-ics:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
