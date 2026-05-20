/**
 * Seed script: populates the strength_exercise_catalog table with the v1
 * exercise set. Idempotent — re-running upserts the same canonical names.
 *
 * Run: npx ts-node --project tsconfig.json scripts/seed-exercise-catalog.ts
 *
 * Requires in .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Garmin IDs (garmin_exercise_category / garmin_exercise_name) are placeholders
 * for entries marked garmin_supported: false. To populate them, follow the
 * process in docs/garmin_exercise_catalog.md.
 */

import * as fsSync from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'

const envPath = path.resolve(process.cwd(), '.env.local')
if (fsSync.existsSync(envPath)) {
  const envContent = fsSync.readFileSync(envPath, 'utf8')
  envContent.split('\n').forEach(line => {
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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing required env vars: NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

interface CatalogRow {
  canonical_name: string
  display_name: string
  aliases: string[]
  measurement_type: 'reps' | 'duration' | 'distance'
  garmin_exercise_category: string | null
  garmin_exercise_name: string | null
  garmin_step_type: 'STRENGTH' | 'CARDIO' | 'OTHER'
  garmin_supported: boolean
}

// v1 catalog. Garmin IDs left null where we haven't captured them yet —
// flip garmin_supported to true once IDs are populated.
const CATALOG: CatalogRow[] = [
  // Bodyweight — reps
  { canonical_name: 'pushup', display_name: 'Push-up', aliases: ['push-up', 'push up', 'press-up', 'press up', 'pressup'], measurement_type: 'reps', garmin_exercise_category: 'PUSH_UP', garmin_exercise_name: 'PUSH_UP', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'squat', display_name: 'Bodyweight Squat', aliases: ['bodyweight squat', 'air squat'], measurement_type: 'reps', garmin_exercise_category: 'SQUAT', garmin_exercise_name: 'AIR_SQUAT', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'lunge', display_name: 'Lunge', aliases: ['forward lunge', 'reverse lunge', 'walking lunge'], measurement_type: 'reps', garmin_exercise_category: 'LUNGE', garmin_exercise_name: 'ALTERNATING_LUNGE', garmin_step_type: 'STRENGTH', garmin_supported: false },
  { canonical_name: 'glute_bridge', display_name: 'Glute Bridge', aliases: ['bridge', 'hip bridge'], measurement_type: 'reps', garmin_exercise_category: 'HIP_RAISE', garmin_exercise_name: 'HIP_RAISE', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'crunch', display_name: 'Crunch', aliases: ['crunches', 'ab crunch'], measurement_type: 'reps', garmin_exercise_category: 'CRUNCH', garmin_exercise_name: 'CRUNCH', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'situp', display_name: 'Sit-up', aliases: ['sit-up', 'sit up', 'situps'], measurement_type: 'reps', garmin_exercise_category: 'SIT_UP', garmin_exercise_name: 'SIT_UP', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'dead_bug', display_name: 'Dead Bug', aliases: ['deadbug', 'dead-bug'], measurement_type: 'reps', garmin_exercise_category: 'HIP_STABILITY', garmin_exercise_name: 'DEAD_BUG', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'bird_dog', display_name: 'Bird Dog', aliases: ['birddog', 'bird-dog'], measurement_type: 'reps', garmin_exercise_category: 'CORE', garmin_exercise_name: 'BIRD_DOG', garmin_step_type: 'STRENGTH', garmin_supported: false },
  { canonical_name: 'mountain_climber', display_name: 'Mountain Climber', aliases: ['mountain climbers'], measurement_type: 'reps', garmin_exercise_category: 'PLANK', garmin_exercise_name: 'MOUNTAIN_CLIMBER', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'burpee', display_name: 'Burpee', aliases: ['burpees'], measurement_type: 'reps', garmin_exercise_category: 'TOTAL_BODY', garmin_exercise_name: 'BURPEE', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'jump_squat', display_name: 'Jump Squat', aliases: ['jumping squat'], measurement_type: 'reps', garmin_exercise_category: 'PLYO', garmin_exercise_name: 'JUMP_SQUAT', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'jumping_jack', display_name: 'Jumping Jack', aliases: ['jumping jacks', 'star jump', 'star jumps'], measurement_type: 'reps', garmin_exercise_category: 'CARDIO', garmin_exercise_name: 'JUMPING_JACKS', garmin_step_type: 'CARDIO', garmin_supported: true },
  { canonical_name: 'high_knees', display_name: 'High Knees', aliases: [], measurement_type: 'duration', garmin_exercise_category: 'WARM_UP', garmin_exercise_name: 'WALKING_HIGH_KNEES', garmin_step_type: 'CARDIO', garmin_supported: true },
  { canonical_name: 'butt_kicks', display_name: 'Butt Kicks', aliases: ['butt kickers'], measurement_type: 'duration', garmin_exercise_category: 'CARDIO', garmin_exercise_name: 'BUTT_KICKS', garmin_step_type: 'CARDIO', garmin_supported: false },

  // Bodyweight — duration
  { canonical_name: 'plank', display_name: 'Plank', aliases: ['front plank', 'forearm plank'], measurement_type: 'duration', garmin_exercise_category: 'PLANK', garmin_exercise_name: 'PLANK', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'side_plank', display_name: 'Side Plank', aliases: ['side-plank'], measurement_type: 'duration', garmin_exercise_category: 'PLANK', garmin_exercise_name: 'SIDE_PLANK', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'wall_sit', display_name: 'Wall Sit', aliases: ['wall-sit'], measurement_type: 'duration', garmin_exercise_category: 'SQUAT', garmin_exercise_name: 'BODY_WEIGHT_WALL_SQUAT', garmin_step_type: 'STRENGTH', garmin_supported: true },

  // Dumbbell
  { canonical_name: 'dumbbell_row', display_name: 'Dumbbell Row', aliases: ['db row', 'one-arm row', 'single-arm row'], measurement_type: 'reps', garmin_exercise_category: 'ROW', garmin_exercise_name: 'DUMBBELL_ROW', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'dumbbell_press', display_name: 'Dumbbell Press', aliases: ['db press', 'dumbbell bench press'], measurement_type: 'reps', garmin_exercise_category: 'BENCH_PRESS', garmin_exercise_name: 'DUMBBELL_BENCH_PRESS', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'dumbbell_curl', display_name: 'Dumbbell Curl', aliases: ['db curl', 'bicep curl'], measurement_type: 'reps', garmin_exercise_category: 'CURL', garmin_exercise_name: 'DUMBBELL_BICEPS_CURL', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'dumbbell_lunge', display_name: 'Dumbbell Lunge', aliases: ['db lunge'], measurement_type: 'reps', garmin_exercise_category: 'LUNGE', garmin_exercise_name: 'DUMBBELL_LUNGE', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'dumbbell_deadlift', display_name: 'Dumbbell Deadlift', aliases: ['db deadlift'], measurement_type: 'reps', garmin_exercise_category: 'DEADLIFT', garmin_exercise_name: 'DUMBBELL_DEADLIFT', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'dumbbell_squat', display_name: 'Dumbbell Squat', aliases: ['db squat', 'goblet squat'], measurement_type: 'reps', garmin_exercise_category: 'SQUAT', garmin_exercise_name: 'GOBLET_SQUAT', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'dumbbell_shoulder_press', display_name: 'Dumbbell Shoulder Press', aliases: ['db shoulder press', 'overhead press dumbbell'], measurement_type: 'reps', garmin_exercise_category: 'SHOULDER_PRESS', garmin_exercise_name: 'DUMBBELL_SHOULDER_PRESS', garmin_step_type: 'STRENGTH', garmin_supported: true },

  // Barbell
  { canonical_name: 'barbell_squat', display_name: 'Barbell Squat', aliases: ['back squat', 'bb squat'], measurement_type: 'reps', garmin_exercise_category: 'SQUAT', garmin_exercise_name: 'BARBELL_BACK_SQUAT', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'deadlift', display_name: 'Deadlift', aliases: ['barbell deadlift', 'conventional deadlift'], measurement_type: 'reps', garmin_exercise_category: 'DEADLIFT', garmin_exercise_name: 'BARBELL_DEADLIFT', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'bench_press', display_name: 'Bench Press', aliases: ['barbell bench press', 'flat bench press'], measurement_type: 'reps', garmin_exercise_category: 'BENCH_PRESS', garmin_exercise_name: 'BARBELL_BENCH_PRESS', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'overhead_press', display_name: 'Overhead Press', aliases: ['ohp', 'military press', 'standing press'], measurement_type: 'reps', garmin_exercise_category: 'SHOULDER_PRESS', garmin_exercise_name: 'OVERHEAD_BARBELL_PRESS', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'bent_over_row', display_name: 'Bent-over Row', aliases: ['barbell row', 'bent over row'], measurement_type: 'reps', garmin_exercise_category: 'ROW', garmin_exercise_name: 'BENT_OVER_ROW_WITH_BARBELL', garmin_step_type: 'STRENGTH', garmin_supported: true },

  // Mobility / stretching — duration
  { canonical_name: 'hamstring_stretch', display_name: 'Hamstring Stretch', aliases: ['hamstring stretches'], measurement_type: 'duration', garmin_exercise_category: 'WARM_UP', garmin_exercise_name: 'STANDING_HAMSTRING_STRETCH', garmin_step_type: 'OTHER', garmin_supported: true },
  { canonical_name: 'quad_stretch', display_name: 'Quad Stretch', aliases: ['quadriceps stretch'], measurement_type: 'duration', garmin_exercise_category: 'WARM_UP', garmin_exercise_name: 'QUADRICEPS_STRETCH', garmin_step_type: 'OTHER', garmin_supported: false },
  { canonical_name: 'hip_flexor_stretch', display_name: 'Hip Flexor Stretch', aliases: [], measurement_type: 'duration', garmin_exercise_category: 'WARM_UP', garmin_exercise_name: 'STRETCH_HIP_FLEXOR_AND_QUAD', garmin_step_type: 'OTHER', garmin_supported: true },
  { canonical_name: 'pigeon_pose', display_name: 'Pigeon Pose', aliases: ['pigeon stretch'], measurement_type: 'duration', garmin_exercise_category: 'WARM_UP', garmin_exercise_name: 'STRETCH_PIGEON_POSE', garmin_step_type: 'OTHER', garmin_supported: true },
  { canonical_name: 'cat_cow', display_name: 'Cat-Cow', aliases: ['cat cow', 'cat/cow'], measurement_type: 'reps', garmin_exercise_category: 'WARM_UP', garmin_exercise_name: 'CAT_CAMEL', garmin_step_type: 'OTHER', garmin_supported: true },
  { canonical_name: 'downward_dog', display_name: 'Downward Dog', aliases: ['downward facing dog', 'down dog'], measurement_type: 'duration', garmin_exercise_category: 'WARM_UP', garmin_exercise_name: 'DOWNWARD_DOG', garmin_step_type: 'OTHER', garmin_supported: false },
  { canonical_name: 'foam_roll', display_name: 'Foam Roll', aliases: ['foam rolling', 'foam roller'], measurement_type: 'duration', garmin_exercise_category: 'WARM_UP', garmin_exercise_name: 'FOAM_ROLL', garmin_step_type: 'OTHER', garmin_supported: false },
]

async function main() {
  console.log(`Seeding ${CATALOG.length} exercises...`)

  let inserted = 0
  let updated = 0

  for (const row of CATALOG) {
    const { data: existing, error: fetchErr } = await supabase
      .from('strength_exercise_catalog')
      .select('id')
      .eq('canonical_name', row.canonical_name)
      .maybeSingle()
    if (fetchErr) {
      console.error(`Failed to check ${row.canonical_name}:`, fetchErr.message)
      continue
    }

    if (existing) {
      const { error } = await supabase
        .from('strength_exercise_catalog')
        .update(row)
        .eq('id', existing.id)
      if (error) {
        console.error(`Failed to update ${row.canonical_name}:`, error.message)
      } else {
        updated++
      }
    } else {
      const { error } = await supabase
        .from('strength_exercise_catalog')
        .insert(row)
      if (error) {
        console.error(`Failed to insert ${row.canonical_name}:`, error.message)
      } else {
        inserted++
      }
    }
  }

  console.log(`Done. inserted=${inserted} updated=${updated} total=${CATALOG.length}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
