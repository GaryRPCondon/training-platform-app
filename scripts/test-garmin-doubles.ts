// Run with: npx tsx scripts/test-garmin-doubles.ts
//
// Empirical test: does Garmin's /workout-service/schedule/{workoutId} endpoint
// permit two workouts scheduled on the same date through the garmin-connect SDK?
//
// The Garmin server itself supports doubles (verified manually via web UI).
// This script tests whether the API call sequence works through garmin-connect@1.6.2.
//
// Uses the garmin-connect package directly (not our GarminClient wrapper),
// because GarminClient.createWorkout expects a Supabase-backed token store
// that doesn't exist in a CLI script.

import { GarminConnect } from 'garmin-connect'
import { mapToGarminWorkout } from '../lib/garmin/workout-mapper'

const GC_API = 'https://connectapi.garmin.com'

function formatDate(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

async function run() {
  const username = process.env.GARMIN_EMAIL
  const password = process.env.GARMIN_PASSWORD

  if (!username || !password) {
    console.error('Set GARMIN_EMAIL and GARMIN_PASSWORD environment variables')
    process.exit(1)
  }

  const client = new GarminConnect({ username, password })
  let workoutIdA: string | null = null
  let workoutIdB: string | null = null

  try {
    console.log('Logging in...')
    await client.login()
    console.log('Login OK')

    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    const date = formatDate(future)
    console.log(`Target date: ${date}`)

    const payloadA = mapToGarminWorkout({
      description: 'SPLIT-TEST-A (delete me)',
      workout_type: 'easy_run',
      distance_target_meters: 11000,
      duration_target_seconds: null,
      intensity_target: 'easy',
      structured_workout: null,
    })
    const payloadB = mapToGarminWorkout({
      description: 'SPLIT-TEST-B (delete me)',
      workout_type: 'easy_run',
      distance_target_meters: 10000,
      duration_target_seconds: null,
      intensity_target: 'easy',
      structured_workout: null,
    })

    console.log('Creating workout A...')
    const a = await client.post<{ workoutId: string | number }>(
      `${GC_API}/workout-service/workout`,
      payloadA
    )
    workoutIdA = String(a.workoutId)
    console.log(`  workoutId A = ${workoutIdA}`)

    console.log('Creating workout B...')
    const b = await client.post<{ workoutId: string | number }>(
      `${GC_API}/workout-service/workout`,
      payloadB
    )
    workoutIdB = String(b.workoutId)
    console.log(`  workoutId B = ${workoutIdB}`)

    console.log(`Scheduling A on ${date}...`)
    await client.post(`${GC_API}/workout-service/schedule/${workoutIdA}`, { date })
    console.log('  A scheduled OK')

    console.log(`Scheduling B on ${date} (same day as A)...`)
    try {
      await client.post(`${GC_API}/workout-service/schedule/${workoutIdB}`, { date })
      console.log('  B scheduled OK')
      console.log('\nRESULT: SUPPORTED — same-date scheduling works through our API path.')
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: unknown }; message?: string }
      console.log('  B FAILED')
      console.log('\nRESULT: REJECTED')
      console.log(`  HTTP status: ${e.response?.status ?? 'unknown'}`)
      console.log(`  Body: ${JSON.stringify(e.response?.data ?? e.message ?? err)}`)
    }
  } catch (err: unknown) {
    const e = err as { response?: { status?: number; data?: unknown }; message?: string }
    console.error('\nUNEXPECTED ERROR:', e.message ?? err)
    if (e.response) {
      console.error('  status:', e.response.status)
      console.error('  body:', e.response.data)
    }
    process.exitCode = 1
  } finally {
    console.log('\nCleanup...')
    if (workoutIdA) {
      try {
        await client.deleteWorkout({ workoutId: workoutIdA })
        console.log(`  Deleted A (${workoutIdA})`)
      } catch {
        console.warn(`  Failed to delete A (${workoutIdA}) — manually remove from Garmin if needed`)
      }
    }
    if (workoutIdB) {
      try {
        await client.deleteWorkout({ workoutId: workoutIdB })
        console.log(`  Deleted B (${workoutIdB})`)
      } catch {
        console.warn(`  Failed to delete B (${workoutIdB}) — manually remove from Garmin if needed`)
      }
    }
  }
}

run()
