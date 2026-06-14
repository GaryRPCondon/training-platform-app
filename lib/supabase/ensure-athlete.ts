import { SupabaseClient } from '@supabase/supabase-js'

/**
 * Ensures an athlete record exists for the authenticated user.
 *
 * Athlete records are always keyed by the auth user id (every creation path
 * inserts `id: userId`), so we look up strictly by id. We intentionally do NOT
 * fall back to matching by email: a second auth account sharing an email string
 * must never be mapped onto the original athlete's data.
 */
export async function ensureAthleteExists(
    supabase: SupabaseClient,
    userId: string,
    userEmail: string | undefined
): Promise<{ athleteId: string; error?: string }> {
    // Check if athlete exists by user ID
    const { data: athlete } = await supabase
        .from('athletes')
        .select('id')
        .eq('id', userId)
        .single()

    if (athlete) {
        return { athleteId: athlete.id }
    }

    // Create new athlete record
    console.log(`Creating new athlete record for user ${userId}`)
    const { data: newAthlete, error } = await supabase
        .from('athletes')
        .insert({
            id: userId,
            email: userEmail,
            created_at: new Date().toISOString()
        })
        .select('id')
        .single()

    if (error) {
        console.error('Failed to create athlete:', error)
        return {
            athleteId: userId,
            error: `Failed to create athlete: ${error.message}`
        }
    }

    console.log(`Created athlete record: ${newAthlete.id}`)
    return { athleteId: newAthlete.id }
}
