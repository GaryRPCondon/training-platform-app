import { SupabaseClient } from '@supabase/supabase-js'

/**
 * Checks if the current authenticated user is an admin.
 * Returns { isAdmin, userId } or throws if not authenticated.
 */
export async function isUserAdmin(supabase: SupabaseClient): Promise<{ isAdmin: boolean; userId: string }> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
        throw new Error('Not authenticated')
    }

    const { data: athlete } = await supabase
        .from('athletes')
        .select('is_admin')
        .eq('id', user.id)
        .single()

    return {
        isAdmin: athlete?.is_admin ?? false,
        userId: user.id,
    }
}
