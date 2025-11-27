import { NextResponse } from 'next/server'
import { detectWorkoutFlags } from '@/lib/analysis/flag-detector'
import { getActiveObservations, dismissObservation } from '@/lib/analysis/observation-manager'
import { proposeAdjustments } from '@/lib/analysis/adjustment-proposer'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const athleteId = user.id

        // Run flag detection
        await detectWorkoutFlags(athleteId)

        // Get active observations
        const observations = await getActiveObservations(athleteId)

        // Get adjustment proposals
        const adjustments = await proposeAdjustments(athleteId)

        return NextResponse.json({ observations, adjustments })
    } catch (error) {
        console.error('Failed to get observations:', error)
        return NextResponse.json(
            { error: 'Failed to fetch observations' },
            { status: 500 }
        )
    }
}

export async function POST(request: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { action, observationId } = await request.json()

        if (action === 'dismiss' && observationId) {
            await dismissObservation(observationId)
            return NextResponse.json({ success: true })
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    } catch (error) {
        console.error('Failed to process observation action:', error)
        return NextResponse.json(
            { error: 'Failed to process action' },
            { status: 500 }
        )
    }
}
