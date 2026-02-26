import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
    try {
        const { userId, email } = await request.json()

        if (!userId || !email) {
            return NextResponse.json(
                { error: 'User ID and email are required' },
                { status: 400 }
            )
        }

        // Use service role client to bypass RLS policies and to verify the auth user
        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            {
                auth: {
                    autoRefreshToken: false,
                    persistSession: false
                }
            }
        )

        // Verify the userId/email actually exist in auth.users before inserting.
        // This prevents unauthenticated callers from injecting arbitrary athlete records.
        const { data: authUserData, error: authLookupError } = await supabaseAdmin.auth.admin.getUserById(userId)
        if (authLookupError || !authUserData?.user || authUserData.user.email !== email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Insert athlete record with default values
        const { data, error } = await supabaseAdmin
            .from('athletes')
            .insert({
                id: userId,
                email: email,
                name: null,
                preferred_units: 'metric',
                preferred_llm_provider: 'deepseek',
                week_starts_on: 1
            })
            .select()
            .single()

        if (error) {
            console.error('Error creating athlete:', error)
            return NextResponse.json(
                {
                    error: 'Failed to create athlete profile',
                    details: error
                },
                { status: 500 }
            )
        }

        return NextResponse.json({ success: true, athlete: data })
    } catch (error: any) {
        console.error('Unexpected error creating athlete:', error)
        return NextResponse.json(
            { error: error.message || 'Internal server error' },
            { status: 500 }
        )
    }
}
