import { NextResponse } from 'next/server'
import { StravaClient } from '@/lib/strava/client'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')
    const error = searchParams.get('error')

    if (error) {
        return NextResponse.redirect(new URL('/dashboard/profile?error=strava_auth_failed', request.url))
    }

    if (!code) {
        return NextResponse.redirect(new URL('/dashboard/profile?error=missing_code', request.url))
    }

    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.redirect(new URL('/login', request.url))
        }

        // Ensure athlete record exists - check by ID first
        let { data: athlete } = await supabase
            .from('athletes')
            .select('id')
            .eq('id', user.id)
            .single()

        if (!athlete) {
            // Check if athlete exists with this email but different ID
            const { data: athleteByEmail } = await supabase
                .from('athletes')
                .select('id')
                .eq('email', user.email)
                .single()

            if (athleteByEmail) {
                console.log('Found existing athlete by email:', athleteByEmail.id, '- Using this athlete ID')
                athlete = athleteByEmail
            } else {
                console.log('Creating athlete record for user:', user.id)
                const { data: newAthlete, error: athleteCreateError } = await supabase
                    .from('athletes')
                    .insert({
                        id: user.id,
                        email: user.email,
                        created_at: new Date().toISOString()
                    })
                    .select()
                    .single()

                if (athleteCreateError) {
                    console.error('Failed to create athlete:', athleteCreateError)
                    return NextResponse.redirect(new URL('/dashboard/profile?error=athlete_creation_failed', request.url))
                }
                athlete = newAthlete
            }
        }

        if (!athlete) {
            throw new Error('Failed to resolve athlete record')
        }

        const client = new StravaClient()
        const tokens = await client.exchangeCodeForToken(code)

        await client.saveTokens(athlete.id, tokens, supabase)

        return NextResponse.redirect(new URL('/dashboard/profile?success=strava_connected', request.url))
    } catch (err) {
        console.error('Strava callback error:', err)
        return NextResponse.redirect(new URL('/dashboard/profile?error=internal_error', request.url))
    }
}
