
import { createClient } from '@supabase/supabase-js'
import path from 'path'
import fs from 'fs'
import { differenceInMinutes, differenceInHours, isSameDay } from 'date-fns'

// Load environment variables manually
const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf8')
    envConfig.split('\n').forEach(line => {
        const firstEquals = line.indexOf('=')
        if (firstEquals !== -1) {
            const key = line.substring(0, firstEquals).trim()
            let value = line.substring(firstEquals + 1).trim()
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1)
            }
            if (key) process.env[key] = value
        }
    })
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

// --- DUPLICATED LOGIC FROM MERGE-DETECTOR FOR DEBUGGING ---
function analyzeMatch(newActivity: any, existing: any) {
    console.log(`\n--- Analyzing Pair ---`)
    console.log(`A (New/Strava?): ID=${newActivity.id} Source=${newActivity.source} Date=${newActivity.start_time} Dist=${newActivity.distance_meters}`)
    console.log(`B (Existing/Garmin?): ID=${existing.id} Source=${existing.source} Date=${existing.start_time} Dist=${existing.distance_meters}`)

    const date1 = new Date(newActivity.start_time)
    const date2 = new Date(existing.start_time)

    const isDateOnly1 = date1.getHours() === 0 && date1.getMinutes() === 0 && date1.getSeconds() === 0
    const isDateOnly2 = date2.getHours() === 0 && date2.getMinutes() === 0 && date2.getSeconds() === 0
    const isDateOnlyMatch = isDateOnly1 || isDateOnly2

    console.log(`Is Date Only Match? ${isDateOnlyMatch} (A=${isDateOnly1}, B=${isDateOnly2})`)

    let timeDiff = 0
    if (isDateOnlyMatch) {
        const hoursDiff = Math.abs(differenceInHours(date1, date2))
        console.log(`Hours Diff: ${hoursDiff}`)
        if (hoursDiff > 24) {
            console.log(`❌ Failed: Hours diff > 24`)
            return
        }
        timeDiff = 0
    } else {
        timeDiff = Math.abs(differenceInMinutes(date1, date2))
        console.log(`Time Diff: ${timeDiff} minutes`)
        if (timeDiff > 2) {
            console.log(`❌ Failed: Time diff > 2 mins`)
            return
        }
    }

    const distanceDiff = Math.abs(
        (newActivity.distance_meters - existing.distance_meters) / existing.distance_meters
    ) * 100
    console.log(`Distance Diff: ${distanceDiff.toFixed(4)}%`)

    let durationDiff = 0
    if (newActivity.duration_seconds && existing.duration_seconds) {
        durationDiff = Math.abs(
            (newActivity.duration_seconds - existing.duration_seconds) / existing.duration_seconds
        ) * 100
        console.log(`Duration Diff: ${durationDiff.toFixed(4)}%`)
    } else {
        console.log(`Duration Diff: Skipped (one missing)`)
    }

    let score = 100
    score -= timeDiff * 10
    score -= distanceDiff * 20
    if (newActivity.duration_seconds && existing.duration_seconds) {
        score -= durationDiff * 10
    }
    console.log(`Calculated Score: ${score}`)

    if (isDateOnlyMatch) {
        console.log(`Mode: Date-Only Strict Rules`)
        if (score >= 90 && distanceDiff <= 5) {
            console.log(`✅ Result: HIGH confidence (Match!)`)
        } else if (score >= 70 && distanceDiff <= 1) {
            console.log(`⚠️ Result: MEDIUM confidence`)
        } else if (score >= 50) {
            console.log(`⚠️ Result: LOW confidence`)
        } else {
            console.log(`❌ Result: No Match (Score < 50 or Dist > 1%)`)
        }
    } else {
        console.log(`Mode: Precise Rules`)
        if (score >= 90 && distanceDiff <= 0.5 && durationDiff <= 1) {
            console.log(`✅ Result: HIGH confidence (Match!)`)
        } else {
            console.log(`❌ Result: No Match (Precise rules failed)`)
        }
    }
}

async function run() {
    const { data: activities } = await supabase
        .from('activities')
        .select('*')
        .order('start_time', { ascending: false })
        .limit(50)

    if (!activities) return

    // Group by day to find potential pairs
    const sorted = activities.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())

    for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i]
        const b = sorted[i + 1]

        // Check if they are somewhat close (within 24 hours)
        const timeDiffHours = Math.abs(new Date(a.start_time).getTime() - new Date(b.start_time).getTime()) / 1000 / 60 / 60

        if (timeDiffHours < 24 && a.source !== b.source) {
            analyzeMatch(a, b)
        }
    }
}

run()
