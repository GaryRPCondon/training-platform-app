import { SupabaseClient } from '@supabase/supabase-js'

/**
 * Ensures an athlete record exists for the authenticated user.
 * If the user's ID doesn't have an athlete record, it checks by email.
 * If an athlete exists with that email, it returns that athlete's ID.
 * Otherwise, it creates a new athlete record.
 * 
 * This handles the case where a user may have multiple auth accounts
 * with the same email but different IDs.
 */
export async function ensureAthleteExists(
    supabase: SupabaseClient,
    userId: string,
    userEmail: string | undefined
): Promise<{ athleteId: string; error?: string }> {
    // Check if athlete exists by user ID
    let { data: athlete } = await supabase
        .from('athletes')
        .select('id')
        .eq('id', userId)
        .single()

    if (athlete) {
        return { athleteId: athlete.id }
    }

    // Check if athlete exists by email
    if (userEmail) {
        const { data: athleteByEmail } = await supabase
            .from('athletes')
            .select('id')
            .eq('email', userEmail)
            .single()

        if (athleteByEmail) {
            console.log(`Using existing athlete ${athleteByEmail.id} for user ${userId} (matched by email: ${userEmail})`)
            return { athleteId: athleteByEmail.id }
        }
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
