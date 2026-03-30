import { NextResponse } from 'next/server'
import { detectWorkoutFlags } from '@/lib/analysis/flag-detector'
import { getActiveObservations } from '@/lib/analysis/observation-manager'
import { proposeAdjustments } from '@/lib/analysis/adjustment-proposer'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const observationActionSchema = z.object({
  action: z.literal('dismiss'),
  observationId: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
})

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

        const rawBody = await request.json()
        const parsed = observationActionSchema.safeParse(rawBody)
        if (!parsed.success) {
            return NextResponse.json(
                { error: 'Invalid action', details: parsed.error.flatten().fieldErrors },
                { status: 400 }
            )
        }

        const obsId = typeof parsed.data.observationId === 'string'
            ? parseInt(parsed.data.observationId, 10)
            : parsed.data.observationId

        // Ownership-verified dismiss: only update if the flag belongs to this athlete
        const { error: dismissError } = await supabase
            .from('workout_flags')
            .update({ acknowledged: true })
            .eq('id', obsId)
            .eq('athlete_id', user.id)

        if (dismissError) throw dismissError
        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Failed to process observation action:', error)
        return NextResponse.json(
            { error: 'Failed to process action' },
            { status: 500 }
        )
    }
}
