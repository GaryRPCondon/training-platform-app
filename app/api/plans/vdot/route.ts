import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ensureAthleteExists } from '@/lib/supabase/ensure-athlete'
import { calculateTrainingPaces } from '@/lib/training/vdot'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { athleteId, error: athleteError } = await ensureAthleteExists(supabase, user.id, user.email)
    if (athleteError) {
      return NextResponse.json({ error: athleteError }, { status: 500 })
    }

    // Get VDOT from athlete profile
    const { data: athlete } = await supabase
      .from('athletes')
      .select('vdot, training_paces, pace_source, pace_source_data')
      .eq('id', athleteId)
      .single()

    return NextResponse.json({
      vdot: athlete?.vdot ?? null,
      training_paces: athlete?.training_paces ?? null,
      pace_source: athlete?.pace_source ?? null,
      pace_source_data: athlete?.pace_source_data ?? null,
    })
  } catch (error) {
    console.error('Get VDOT error:', error)
    return NextResponse.json({ error: 'Failed to get VDOT data' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { vdot, source, sourceData } = body

    if (!vdot || typeof vdot !== 'number' || vdot < 20 || vdot > 100) {
      return NextResponse.json({ error: 'Invalid VDOT value (must be 20-100)' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { athleteId, error: athleteError } = await ensureAthleteExists(supabase, user.id, user.email)
    if (athleteError) {
      return NextResponse.json({ error: athleteError }, { status: 500 })
    }

    // Calculate new training paces
    const trainingPaces = calculateTrainingPaces(vdot)
    const paceSource = source || 'vdot_direct'
    const paceSourceData = sourceData || { vdot }

    // Always save to athlete profile
    const { error: athleteUpdateError } = await supabase
      .from('athletes')
      .update({
        vdot,
        training_paces: trainingPaces,
        pace_source: paceSource,
        pace_source_data: paceSourceData,
      })
      .eq('id', athleteId)

    if (athleteUpdateError) throw athleteUpdateError

    // Also update the active plan if one exists
    const { data: plan } = await supabase
      .from('training_plans')
      .select('id')
      .eq('athlete_id', athleteId)
      .eq('status', 'active')
      .single()

    if (plan) {
      await supabase
        .from('training_plans')
        .update({
          vdot,
          training_paces: trainingPaces,
          pace_source: paceSource,
          pace_source_data: paceSourceData,
        })
        .eq('id', plan.id)
    }

    return NextResponse.json({
      success: true,
      vdot,
      training_paces: trainingPaces,
    })
  } catch (error) {
    console.error('Update VDOT error:', error)
    return NextResponse.json({ error: 'Failed to update VDOT' }, { status: 500 })
  }
}
