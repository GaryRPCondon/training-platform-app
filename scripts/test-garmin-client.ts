// Run with: npx ts-node scripts/test-garmin-client.ts

import { GarminClient } from '../lib/garmin/client'

async function testGarminClient() {
  const client = new GarminClient()

  const email = process.env.GARMIN_EMAIL
  const password = process.env.GARMIN_PASSWORD

  if (!email || !password) {
    console.error('Set GARMIN_EMAIL and GARMIN_PASSWORD environment variables')
    console.error('Example: GARMIN_EMAIL=your@email.com GARMIN_PASSWORD=yourpass npx ts-node scripts/test-garmin-client.ts')
    process.exit(1)
  }

  console.log('Testing Garmin client...')

  try {
    // Test login
    console.log('\n1. Testing login...')
    try {
      const tokens = await client.login(email, password)
      console.log('✅ Login successful')
      console.log('   OAuth1 token:', tokens.oauth1.oauth_token.substring(0, 20) + '...')
      console.log('   OAuth2 expires:', new Date(tokens.oauth2.expires_at * 1000).toISOString())
    } catch (error: any) {
      if (error.message.includes('MFA')) {
        console.log('⚠️  MFA is enabled on this account')
        console.log('   Error:', error.message)
        console.log('\nTo test this implementation, you need a Garmin account without MFA enabled.')
        console.log('Skipping remaining tests.')
        return
      }
      throw error
    }

    // Test get activities
    console.log('\n2. Testing getActivities...')
    const endDate = new Date()
    const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const activities = await client.getActivities(startDate, endDate, 5)
    console.log(`✅ Retrieved ${activities.length} activities`)
    if (activities.length > 0) {
      const first = activities[0]
      console.log('   First activity:', {
        id: first.activityId,
        name: first.activityName,
        type: first.activityType?.typeKey,
        date: first.startTimeLocal,
        distance: `${(first.distance / 1000).toFixed(2)} km`
      })
    }

    // Test get user profile
    console.log('\n3. Testing getUserProfile...')
    const profile = await client.getUserProfile()
    console.log('✅ Retrieved profile')
    console.log('   Display name:', profile.displayName)
    console.log('   Full name:', profile.fullName)

    console.log('\n✅ All tests passed!')

  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message)
    if (error.response) {
      console.error('Response status:', error.response.status)
      console.error('Response data:', error.response.data)
    }
    process.exit(1)
  }
}

testGarminClient()
