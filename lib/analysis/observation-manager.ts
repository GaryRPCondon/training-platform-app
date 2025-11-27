import { createClient } from '@/lib/supabase/client'

export interface Observation {
    id: string
    type: string
    severity: 'info' | 'warning' | 'concern'
    message: string
    data?: any
    acknowledged: boolean
    dismissed: boolean
    created_at: string
}

/**
 * Create a new observation
 */
export async function createObservation(
    athleteId: string,
    type: string,
    severity: 'info' | 'warning' | 'concern',
    message: string,
    data?: any
): Promise<Observation> {
    const supabase = createClient()

    // Check if similar observation already exists (within last 24 hours)
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)

    const { data: existing } = await supabase
        .from('workout_flags')
        .select('*')
        .eq('athlete_id', athleteId)
        .eq('flag_type', type)
        .gte('created_at', yesterday.toISOString())
        .eq('acknowledged', false)
        .limit(1)

    if (existing && existing.length > 0) {
        return {
            id: existing[0].id.toString(),
            type: existing[0].flag_type,
            severity: existing[0].severity,
            message: existing[0].flag_data?.message || message,
            data: existing[0].flag_data,
            acknowledged: existing[0].acknowledged,
            dismissed: false,
            created_at: existing[0].created_at
        }
    }

    const { data: newObs, error } = await supabase
        .from('workout_flags')
        .insert({
            athlete_id: athleteId,
            flag_type: type,
            severity,
            flag_data: {
                message,
                ...data
            },
            acknowledged: false,
            created_at: new Date().toISOString()
        })
        .select()
        .single()

    if (error) throw error

    return {
        id: newObs.id.toString(),
        type: newObs.flag_type,
        severity: newObs.severity,
        message,
        data: newObs.flag_data,
        acknowledged: newObs.acknowledged,
        dismissed: false,
        created_at: newObs.created_at
    }
}

/**
 * Get active observations for an athlete
 */
export async function getActiveObservations(athleteId: string): Promise<Observation[]> {
    const supabase = createClient()

    const { data, error } = await supabase
        .from('workout_flags')
        .select('*')
        .eq('athlete_id', athleteId)
        .eq('acknowledged', false)
        .order('created_at', { ascending: false })

    if (error) throw error

    return (data || []).map(flag => ({
        id: flag.id.toString(),
        type: flag.flag_type,
        severity: flag.severity,
        message: flag.flag_data?.message || 'No message',
        data: flag.flag_data,
        acknowledged: flag.acknowledged,
        dismissed: false,
        created_at: flag.created_at
    }))
}

/**
 * Acknowledge an observation
 */
export async function acknowledgeObservation(observationId: string): Promise<void> {
    const supabase = createClient()

    const { error } = await supabase
        .from('workout_flags')
        .update({ acknowledged: true })
        .eq('id', parseInt(observationId))

    if (error) throw error
}

/**
 * Dismiss an observation (same as acknowledge for now)
 */
export async function dismissObservation(observationId: string): Promise<void> {
    return acknowledgeObservation(observationId)
}
