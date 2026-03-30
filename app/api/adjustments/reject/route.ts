import { NextResponse } from 'next/server'
import { rejectAdjustment } from '@/lib/analysis/adjustment-persistence'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const rejectSchema = z.object({ adjustmentId: z.number() })

export async function POST(request: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const parsed = rejectSchema.safeParse(body)
        if (!parsed.success) {
            return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
        }
        const { adjustmentId } = parsed.data

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
