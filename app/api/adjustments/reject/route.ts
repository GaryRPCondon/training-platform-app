import { NextResponse } from 'next/server'
import { rejectAdjustment } from '@/lib/analysis/adjustment-persistence'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { adjustmentId } = await request.json()

        if (!adjustmentId) {
            return NextResponse.json({ error: 'Adjustment ID required' }, { status: 400 })
        }

        // Verify ownership before rejecting — return 404 to avoid leaking existence
        const { data: owned } = await supabase
            .from('plan_adjustments')
            .select('id')
            .eq('id', adjustmentId)
            .eq('athlete_id', user.id)
            .single()

        if (!owned) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 })
        }

        await rejectAdjustment(adjustmentId)

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Failed to reject adjustment:', error)
        return NextResponse.json({ error: 'Failed to reject adjustment' }, { status: 500 })
    }
}
