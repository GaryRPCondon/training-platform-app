import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface RouteContext {
  params: Promise<{ planId: string }>
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { planId } = await context.params
    const planIdNum = parseInt(planId, 10)

    if (isNaN(planIdNum)) {
      return NextResponse.json(
        { error: 'Invalid plan ID' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      )
    }

    // Verify the plan belongs to the user
    const { data: plan, error: planError } = await supabase
      .from('training_plans')
      .select('athlete_id, status')
      .eq('id', planIdNum)
      .single()

    if (planError || !plan) {
      return NextResponse.json(
        { error: 'Plan not found' },
        { status: 404 }
      )
    }

    if (plan.athlete_id !== user.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      )
    }

    // Delete the plan (cascading deletes will handle related records)
    // Note: Users can delete both draft and active plans
    const { error: deleteError } = await supabase
      .from('training_plans')
      .delete()
      .eq('id', planIdNum)

    if (deleteError) {
      console.error('Error deleting plan:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete plan' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in DELETE /api/plans/[planId]:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
