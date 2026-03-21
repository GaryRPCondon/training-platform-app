import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export async function DELETE() {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Fetch integration tokens for cleanup before deletion
        const { data: integrations } = await supabase
            .from('athlete_integrations')
            .select('platform, platform_athlete_id')
            .eq('athlete_id', user.id)

        // Revoke Strava access if connected
        const stravaIntegration = integrations?.find(i => i.platform === 'strava')
        if (stravaIntegration) {
            try {
                // Get the stored access token
                const { data: tokenData } = await supabase
                    .from('athlete_integrations')
                    .select('*')
                    .eq('athlete_id', user.id)
                    .eq('platform', 'strava')
                    .single()

                if (tokenData) {
                    // Attempt Strava deauthorization
                    await fetch('https://www.strava.com/oauth/deauthorize', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: `access_token=${(tokenData as any).access_token || ''}`,
                    }).catch(() => {
                        // Non-fatal — Strava token will expire eventually
                    })
                }
            } catch {
                // Non-fatal
            }
        }

        // Use service role client to delete user data and auth account
        const supabaseAdmin = createAdminClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            { auth: { autoRefreshToken: false, persistSession: false } }
        )

        // Delete athlete record (CASCADE will clean up related tables)
        const { error: deleteError } = await supabaseAdmin
            .from('athletes')
            .delete()
            .eq('id', user.id)

        if (deleteError) {
            console.error('Failed to delete athlete record:', deleteError)
            return NextResponse.json({ error: 'Failed to delete account data' }, { status: 500 })
        }

        // Delete the auth user
        const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(user.id)

        if (authDeleteError) {
            console.error('Failed to delete auth user:', authDeleteError)
            // Data is already gone, so we still return success but log the issue
        }

        // Sign out the current session
        await supabase.auth.signOut()

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Delete account error:', error)
        return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 })
    }
}
