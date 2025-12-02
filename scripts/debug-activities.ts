
import { createClient } from '@supabase/supabase-js'
import path from 'path'
import fs from 'fs'

// Load environment variables from .env.local manually
const envPath = path.resolve(process.cwd(), '.env.local')
console.log('Loading env from:', envPath)
if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf8')
    envConfig.split('\n').forEach(line => {
        const firstEquals = line.indexOf('=')
        if (firstEquals !== -1) {
            const key = line.substring(0, firstEquals).trim()
            let value = line.substring(firstEquals + 1).trim()
            // Remove quotes if present
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1)
            }
            if (key) {
                process.env[key] = value
            }
        }
    })
} else {
    console.error('Env file not found at:', envPath)
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const supabase = createClient(supabaseUrl, supabaseKey)

async function debugActivities() {
    console.log('Fetching activities...')
    const { data: activities, error } = await supabase
        .from('activities')
        .select('*')
        .order('start_time', { ascending: false })
        .limit(50)

    if (error) {
        console.error('Error fetching activities:', error)
        return
    }

    console.log(`Fetched ${activities.length} activities. Checking for potential duplicates...`)

    if (activities.length > 0) {
        console.log('Sample activity 1:', activities[0])
        console.log('Sample activity 2:', activities[1])
    }

    const sorted = activities.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())

    for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i]
        const b = sorted[i + 1]

        const timeDiff = Math.abs(new Date(a.start_time).getTime() - new Date(b.start_time).getTime()) / 1000 / 60 // minutes

        // Log all close pairs for debugging
        if (timeDiff < 60) {
            console.log(`Pair: ${a.id} (${a.source}) vs ${b.id} (${b.source}) - Diff: ${timeDiff.toFixed(2)} min`)
        }

        if (timeDiff < 5) { // Check within 5 minutes
            console.log('---------------------------------------------------')
            console.log(`Potential Pair Found (Time diff: ${timeDiff.toFixed(2)} min):`)
            console.log(`A: ID=${a.id} Source=${a.source} Time=${a.start_time} Dist=${a.distance_meters} Dur=${a.duration_seconds}`)
            console.log(`B: ID=${b.id} Source=${b.source} Time=${b.start_time} Dist=${b.distance_meters} Dur=${b.duration_seconds}`)

            if (a.source !== b.source) {
                console.log('Different sources - SHOULD MERGE?')
                // Simulate logic
                const distDiff = Math.abs((a.distance_meters - b.distance_meters) / b.distance_meters) * 100
                const durDiff = Math.abs((a.duration_seconds - b.duration_seconds) / b.duration_seconds) * 100
                console.log(`Distance Diff: ${distDiff.toFixed(2)}%`)
                console.log(`Duration Diff: ${durDiff.toFixed(2)}%`)
            } else {
                console.log('Same source - Duplicate import?')
            }
        }
    }
}

debugActivities()
