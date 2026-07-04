import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { GarminClient } from '@/lib/garmin/client'
import { z } from 'zod'
import { errorMessage } from '@/lib/utils/errors'
import { isDemoUser } from '@/lib/demo/demo'

const garminAuthSchema = z.object({
    username: z.string().min(1).max(200),
    password: z.string().min(1).max(200),
})

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Self-guard: public route — reject connecting an integration to the shared
    // demo account (a visitor must not OAuth their own Garmin into it).
    if (isDemoUser(user.id)) {
      return NextResponse.json({ error: 'demo_restricted' }, { status: 403 })
    }

    const body = await request.json()
    const parsed = garminAuthSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Username and password required' }, { status: 400 })
    }
    const { username, password } = parsed.data

    // Get or create athlete record
    let { data: athlete } = await supabase
      .from('athletes')
      .select('id')
      .eq('id', user.id)
      .single()

    if (!athlete) {
      const { data: newAthlete, error: createError } = await supabase
        .from('athletes')
        .insert({ id: user.id, email: user.email })
        .select()
        .single()

      if (createError || !newAthlete) {
        return NextResponse.json(
          { error: 'Failed to create athlete record' },
          { status: 500 }
        )
      }
      athlete = newAthlete
    }

    // Attempt Garmin login
    // At this point, athlete is guaranteed to be non-null
    const garminClient = new GarminClient()
    garminClient.init(supabase, athlete!.id)

    try {
      console.log('Attempting Garmin login for user:', user.email)
      const tokens = await garminClient.login(username, password)
      console.log('Garmin login successful, tokens obtained')

      await garminClient.saveTokensToDB(tokens)
      console.log('Tokens saved to database')

      // Get user profile for confirmation
      // Tokens are already loaded in the client after login
      const profile = await garminClient.getUserProfile()
      console.log('User profile retrieved:', profile.displayName)

      return NextResponse.json({
        success: true,
        message: 'Garmin connected successfully',
        profile: {
          displayName: profile.displayName,
          fullName: profile.fullName
        }
      })
    } catch (error: unknown) {
      // Log the actual error from login
      console.error('Garmin login failed:', errorMessage(error), error instanceof Error ? error.stack : undefined)
      throw error
    }

  } catch (error: unknown) {
    console.error('Garmin auth error:', error instanceof Error ? error.message : 'Unknown error')

    // Handle specific error types
    const message = errorMessage(error)
    if (message?.includes('credentials') || message?.includes('password')) {
      return NextResponse.json(
        { error: 'Invalid Garmin credentials' },
        { status: 401 }
      )
    }

    if (message?.includes('MFA') || message?.includes('multi-factor')) {
      return NextResponse.json(
        { error: message },
        { status: 401 }
      )
    }

    return NextResponse.json(
      { error: 'Failed to connect Garmin', details: message },
      { status: 500 }
    )
  }
}
