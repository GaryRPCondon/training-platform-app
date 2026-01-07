import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { GarminClient } from '@/lib/garmin/client'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { username, password } = body

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username and password required' },
        { status: 400 }
      )
    }

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
    } catch (error: any) {
      // Log the actual error from login
      console.error('Garmin login failed:', error.message, error.stack)
      throw error
    }

  } catch (error: any) {
    console.error('Garmin auth error:', error.message)
    console.error('Full error:', error)

    // Handle specific error types
    if (error.message?.includes('credentials') || error.message?.includes('password')) {
      return NextResponse.json(
        { error: 'Invalid Garmin credentials' },
        { status: 401 }
      )
    }

    if (error.message?.includes('MFA') || error.message?.includes('multi-factor')) {
      return NextResponse.json(
        { error: error.message },
        { status: 401 }
      )
    }

    return NextResponse.json(
      { error: 'Failed to connect Garmin', details: error.message },
      { status: 500 }
    )
  }
}
