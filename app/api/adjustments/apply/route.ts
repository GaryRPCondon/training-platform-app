import { NextResponse } from 'next/server'
import { applyAdjustment } from '@/lib/analysis/adjustment-persistence'
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

        await applyAdjustment(adjustmentId)

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Failed to apply adjustment:', error)
        return NextResponse.json({ error: 'Failed to apply adjustment' }, { status: 500 })
    }
}
