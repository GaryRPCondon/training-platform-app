import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { completePlan } from '@/lib/supabase/plan-activation'

export async function POST(
    _req: Request,
    { params }: { params: Promise<{ planId: string }> }
) {
    try {
        const supabase = await createClient()

        const { data: { user }, error: userError } = await supabase.auth.getUser()
        if (userError || !user) {
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
        }

        const { planId: planIdStr } = await params
        const planId = parseInt(planIdStr, 10)
        if (isNaN(planId)) {
            return NextResponse.json({ error: 'Invalid plan ID' }, { status: 400 })
        }

        // Ownership check + status validation
        const { data: plan, error: fetchError } = await supabase
            .from('training_plans')
            .select('id, status')
            .eq('id', planId)
            .eq('athlete_id', user.id)
            .single()

        if (fetchError || !plan) {
            return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
        }

        if (plan.status === 'completed') {
            return NextResponse.json({ error: 'Plan is already completed' }, { status: 400 })
        }

        await completePlan(supabase, planId, user.id)

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error completing plan:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
