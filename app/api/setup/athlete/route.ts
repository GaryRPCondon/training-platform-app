import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST() {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Check if athlete record exists
        const { data: existingAthlete } = await supabase
            .from('athletes')
            .select('*')
            .eq('id', user.id)
            .single()

        if (existingAthlete) {
            return NextResponse.json({
                message: 'Athlete record already exists',
                athlete: existingAthlete
            })
        }

        // Create athlete record
        const { data: athlete, error } = await supabase
            .from('athletes')
            .insert({
                id: user.id,
                email: user.email,
                created_at: new Date().toISOString()
            })
            .select()
            .single()

        if (error) {
            console.error('Failed to create athlete:', error)
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json({
            message: 'Athlete record created successfully',
            athlete
        })
    } catch (error) {
        console.error('Setup athlete error:', error)
        return NextResponse.json({ error: String(error) }, { status: 500 })
    }
}
