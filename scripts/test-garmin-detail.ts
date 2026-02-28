// Run with: npx tsx scripts/test-garmin-detail.ts
// Fetches a recent activity from Garmin and dumps the full detail response to
// scripts/garmin-detail-output.json so we can see which fields are available
// (splitSummaries, laps, HR, pace, cadence etc.)

import * as fs from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'
import { GarminClient } from '../lib/garmin/client'

// ---------------------------------------------------------------------------
// Load .env.local manually (dotenv may or may not be available as a direct dep)
// ---------------------------------------------------------------------------
function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local')
  if (!fs.existsSync(envPath)) {
    console.error('❌  .env.local not found at', envPath)
    process.exit(1)
  }
  const lines = fs.readFileSync(envPath, 'utf8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    // Strip inline comments and surrounding quotes from the value
    const rawVal = trimmed.slice(eqIdx + 1).replace(/#.*$/, '').trim()
    const val = rawVal.replace(/^["']|["']$/g, '')
    if (!process.env[key]) process.env[key] = val
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function findLapLikeKeys(obj: unknown, prefix = ''): string[] {
  if (!obj || typeof obj !== 'object') return []
  const found: string[] = []
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const fullKey = prefix ? `${prefix}.${k}` : k
    const lk = k.toLowerCase()
    if (lk.includes('lap') || lk.includes('split') || lk.includes('interval')) {
      found.push(fullKey)
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      found.push(...findLapLikeKeys(v, fullKey))
    }
  }
  return found
}

async function tryRawGet(garminClient: GarminClient, url: string): Promise<unknown> {
  // Access the private GarminConnect instance via type assertion
  const raw = (garminClient as unknown as { client: { get: <T>(url: string) => Promise<T> } }).client
  try {
    return await raw.get(url)
  } catch (err: unknown) {
    const e = err as { message?: string; response?: { status?: number } }
    return { _error: e?.message ?? String(err), _status: e?.response?.status }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  loadEnvLocal()

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const athleteId = process.env.NEXT_PUBLIC_ATHLETE_ID

  if (!supabaseUrl || !serviceKey || !athleteId) {
    console.error('❌  Missing required env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_ATHLETE_ID')
    process.exit(1)
  }

  console.log('✅  Env loaded')
  console.log('   Supabase URL:', supabaseUrl)
  console.log('   Athlete ID: ', athleteId)

  // Supabase client (service role — bypasses RLS)
  const supabase = createClient(supabaseUrl, serviceKey)

  // Garmin client
  const garminClient = new GarminClient()
  garminClient.init(supabase, athleteId)

  // -------------------------------------------------------------------------
  // 1. Fetch recent activities and pick the most recent one
  // -------------------------------------------------------------------------
  console.log('\n⏳  Fetching recent activities (last 7 days)…')
  const endDate = new Date()
  const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const activities = await garminClient.getActivities(startDate, endDate, 10)

  if (activities.length === 0) {
    console.error('❌  No activities found in the last 7 days')
    process.exit(1)
  }

  // Activities returned newest-first
  const mostRecent = activities[0]
  const activityId = mostRecent.activityId as number

  console.log(`✅  Found ${activities.length} activities`)
  console.log('   Most recent:')
  console.log('     Name     :', mostRecent.activityName)
  console.log('     Date     :', mostRecent.startTimeLocal)
  console.log('     Distance :', mostRecent.distance ? `${(mostRecent.distance / 1000).toFixed(2)} km` : 'N/A')
  console.log('     Duration :', mostRecent.duration ? `${Math.round(mostRecent.duration / 60)} min` : 'N/A')
  console.log('     ID       :', activityId)

  // -------------------------------------------------------------------------
  // 2. Get full activity detail via the GarminClient wrapper
  // -------------------------------------------------------------------------
  console.log('\n⏳  Calling getActivity() via GarminClient wrapper…')
  const detail = await garminClient.getActivity(activityId)
  console.log('✅  getActivity() returned', detail ? Object.keys(detail).length : 0, 'top-level keys')

  // -------------------------------------------------------------------------
  // 3. Raw GET to several Garmin Connect API endpoints for more detail
  // -------------------------------------------------------------------------
  const GC_BASE = 'https://connectapi.garmin.com'

  console.log('\n⏳  Trying raw API endpoints…')

  const [
    rawActivity,
    rawDetails,
    rawSplits,
    rawLaps,
    rawHrTimeline,
    rawWeather,
  ] = await Promise.all([
    tryRawGet(garminClient, `${GC_BASE}/activity-service/activity/${activityId}`),
    tryRawGet(garminClient, `${GC_BASE}/activity-service/activity/${activityId}/details`),
    tryRawGet(garminClient, `${GC_BASE}/activity-service/activity/${activityId}/splits`),
    tryRawGet(garminClient, `${GC_BASE}/activity-service/activity/${activityId}/laps`),
    tryRawGet(garminClient, `${GC_BASE}/activity-service/activity/${activityId}/hrTimeInZones`),
    tryRawGet(garminClient, `${GC_BASE}/activity-service/activity/${activityId}/weather`),
  ])

  // -------------------------------------------------------------------------
  // 4. Bundle everything and write to JSON file
  // -------------------------------------------------------------------------
  const output = {
    _meta: {
      activityId,
      activityName: mostRecent.activityName,
      date: mostRecent.startTimeLocal,
      fetchedAt: new Date().toISOString(),
    },
    wrapperGetActivity: detail,
    rawEndpoints: {
      'activity-service/activity/{id}': rawActivity,
      'activity-service/activity/{id}/details': rawDetails,
      'activity-service/activity/{id}/splits': rawSplits,
      'activity-service/activity/{id}/laps': rawLaps,
      'activity-service/activity/{id}/hrTimeInZones': rawHrTimeline,
      'activity-service/activity/{id}/weather': rawWeather,
    },
  }

  const outFile = path.join(__dirname, 'garmin-detail-output.json')
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2), 'utf8')
  console.log(`\n✅  Full output written to ${outFile}`)

  // -------------------------------------------------------------------------
  // 5. Console summary
  // -------------------------------------------------------------------------
  console.log('\n════════════════════════════════════════')
  console.log('  SUMMARY')
  console.log('════════════════════════════════════════')

  // --- wrapper result ---
  if (detail) {
    console.log('\n[getActivity() wrapper]')
    console.log('  Top-level keys:', Object.keys(detail).join(', '))
    const lapKeys = findLapLikeKeys(detail)
    if (lapKeys.length > 0) {
      console.log('  Lap/split/interval keys found:', lapKeys.join(', '))
    } else {
      console.log('  ⚠️   No lap/split/interval keys found in wrapper response')
    }
    const d = detail as unknown as Record<string, unknown>
    if (Array.isArray(d.splitSummaries)) {
      console.log(`  ✅  splitSummaries: ${d.splitSummaries.length} entries`)
      const first = d.splitSummaries[0] as Record<string, unknown>
      console.log('  First split keys :', Object.keys(first).join(', '))
      console.log('  First split data :', JSON.stringify(first, null, 4))
    } else {
      console.log('  ✖   splitSummaries: not present')
    }
  }

  // --- raw endpoints summary ---
  const endpoints: Array<[string, unknown]> = [
    ['/activity/{id}', rawActivity],
    ['/activity/{id}/details', rawDetails],
    ['/activity/{id}/splits', rawSplits],
    ['/activity/{id}/laps', rawLaps],
    ['/activity/{id}/hrTimeInZones', rawHrTimeline],
    ['/activity/{id}/weather', rawWeather],
  ]

  console.log('\n[Raw API endpoints]')
  for (const [label, data] of endpoints) {
    if (!data) {
      console.log(`  ${label}: null/empty`)
      continue
    }
    const d = data as Record<string, unknown>
    if (d._error) {
      console.log(`  ${label}: ❌  ERROR ${d._status ?? ''} — ${d._error}`)
      continue
    }
    const keys = Object.keys(d)
    const lapKeys = findLapLikeKeys(d)
    console.log(`  ${label}: ✅  ${keys.length} keys — [${keys.slice(0, 8).join(', ')}${keys.length > 8 ? '…' : ''}]`)
    if (lapKeys.length > 0) {
      console.log(`    → lap/split keys: ${lapKeys.join(', ')}`)
    }
    // If it looks like a lap/split array, show entry count
    for (const k of lapKeys) {
      const topKey = k.split('.')[0]
      const val = d[topKey]
      if (Array.isArray(val)) {
        console.log(`    → ${topKey}: ${val.length} entries`)
        if (val.length > 0) {
          const first = val[0] as Record<string, unknown>
          console.log(`       First entry keys: ${Object.keys(first).join(', ')}`)
          // Print key metrics if present
          const metrics = ['distance', 'duration', 'averageHR', 'averagePace', 'averageCadence', 'averageSpeed', 'maxHR']
          const sample: Record<string, unknown> = {}
          for (const m of metrics) {
            if (m in first) sample[m] = first[m]
          }
          if (Object.keys(sample).length > 0) {
            console.log('       Key metrics    :', JSON.stringify(sample))
          }
        }
      }
    }
  }

  console.log('\n════════════════════════════════════════')
  console.log('  See garmin-detail-output.json for full data')
  console.log('════════════════════════════════════════\n')
}

main().catch(err => {
  console.error('❌  Fatal error:', err)
  process.exit(1)
})
