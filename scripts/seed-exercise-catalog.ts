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
  { canonical_name: 'lunge', display_name: 'Lunge', aliases: ['forward lunge', 'reverse lunge', 'walking lunge'], measurement_type: 'reps', garmin_exercise_category: 'LUNGE', garmin_exercise_name: 'LUNGE', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'glute_bridge', display_name: 'Glute Bridge', aliases: ['bridge', 'hip bridge'], measurement_type: 'reps', garmin_exercise_category: 'HIP_RAISE', garmin_exercise_name: 'HIP_RAISE', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'crunch', display_name: 'Crunch', aliases: ['crunches', 'ab crunch'], measurement_type: 'reps', garmin_exercise_category: 'CRUNCH', garmin_exercise_name: 'CRUNCH', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'situp', display_name: 'Sit-up', aliases: ['sit-up', 'sit up', 'situps'], measurement_type: 'reps', garmin_exercise_category: 'SIT_UP', garmin_exercise_name: 'SIT_UP', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'dead_bug', display_name: 'Dead Bug', aliases: ['deadbug', 'dead-bug'], measurement_type: 'reps', garmin_exercise_category: 'HIP_STABILITY', garmin_exercise_name: 'DEAD_BUG', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'bird_dog', display_name: 'Bird Dog', aliases: ['birddog', 'bird-dog'], measurement_type: 'reps', garmin_exercise_category: 'WARM_UP', garmin_exercise_name: 'OPPOSITE_ARM_AND_LEG_BALANCE', garmin_step_type: 'OTHER', garmin_supported: true },
  { canonical_name: 'mountain_climber', display_name: 'Mountain Climber', aliases: ['mountain climbers'], measurement_type: 'reps', garmin_exercise_category: 'PLANK', garmin_exercise_name: 'MOUNTAIN_CLIMBER', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'burpee', display_name: 'Burpee', aliases: ['burpees'], measurement_type: 'reps', garmin_exercise_category: 'TOTAL_BODY', garmin_exercise_name: 'BURPEE', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'jump_squat', display_name: 'Jump Squat', aliases: ['jumping squat'], measurement_type: 'reps', garmin_exercise_category: 'PLYO', garmin_exercise_name: 'JUMP_SQUAT', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'jumping_jack', display_name: 'Jumping Jack', aliases: ['jumping jacks', 'star jump', 'star jumps'], measurement_type: 'reps', garmin_exercise_category: 'CARDIO', garmin_exercise_name: 'JUMPING_JACKS', garmin_step_type: 'CARDIO', garmin_supported: true },
  { canonical_name: 'high_knees', display_name: 'High Knees', aliases: [], measurement_type: 'duration', garmin_exercise_category: 'WARM_UP', garmin_exercise_name: 'WALKING_HIGH_KNEES', garmin_step_type: 'CARDIO', garmin_supported: true },
  { canonical_name: 'butt_kicks', display_name: 'Butt Kicks', aliases: ['butt kickers'], measurement_type: 'duration', garmin_exercise_category: null, garmin_exercise_name: null, garmin_step_type: 'CARDIO', garmin_supported: false },

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
  { canonical_name: 'quad_stretch', display_name: 'Quad Stretch', aliases: ['quadriceps stretch'], measurement_type: 'duration', garmin_exercise_category: 'WARM_UP', garmin_exercise_name: 'STRETCH_QUAD', garmin_step_type: 'OTHER', garmin_supported: true },
  { canonical_name: 'hip_flexor_stretch', display_name: 'Hip Flexor Stretch', aliases: [], measurement_type: 'duration', garmin_exercise_category: 'WARM_UP', garmin_exercise_name: 'STRETCH_HIP_FLEXOR_AND_QUAD', garmin_step_type: 'OTHER', garmin_supported: true },
  { canonical_name: 'pigeon_pose', display_name: 'Pigeon Pose', aliases: ['pigeon stretch'], measurement_type: 'duration', garmin_exercise_category: 'WARM_UP', garmin_exercise_name: 'STRETCH_PIGEON_POSE', garmin_step_type: 'OTHER', garmin_supported: true },
  { canonical_name: 'cat_cow', display_name: 'Cat-Cow', aliases: ['cat cow', 'cat/cow'], measurement_type: 'reps', garmin_exercise_category: 'WARM_UP', garmin_exercise_name: 'CAT_CAMEL', garmin_step_type: 'OTHER', garmin_supported: true },
  { canonical_name: 'downward_dog', display_name: 'Downward Dog', aliases: ['downward facing dog', 'down dog'], measurement_type: 'duration', garmin_exercise_category: null, garmin_exercise_name: null, garmin_step_type: 'OTHER', garmin_supported: false },
  { canonical_name: 'foam_roll', display_name: 'Foam Roll', aliases: ['foam rolling', 'foam roller'], measurement_type: 'duration', garmin_exercise_category: null, garmin_exercise_name: null, garmin_step_type: 'OTHER', garmin_supported: false },

  // --- v2 additions (2026-06-14): recurring strength/mobility exercises from
  // real imported programs. Every (category, name) pair below was verified
  // verbatim against lib/garmin/garmin-exercise-enum.json before flipping
  // garmin_supported: true. Re-run scripts/verify-exercise-catalog.ts after edits.
  { canonical_name: 'dumbbell_floor_press', display_name: 'Dumbbell Floor Press', aliases: ['db floor press', 'floor press'], measurement_type: 'reps', garmin_exercise_category: 'BENCH_PRESS', garmin_exercise_name: 'DUMBBELL_FLOOR_PRESS', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'dumbbell_bent_over_row', display_name: 'Dumbbell Bent-Over Row', aliases: ['db bent over row', 'dumbbell bent over row', 'bent-over row with dumbbell'], measurement_type: 'reps', garmin_exercise_category: 'ROW', garmin_exercise_name: 'BENT_OVER_ROW_WITH_DUMBELL', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'banded_row', display_name: 'Banded Row', aliases: ['band row', 'resistance band row'], measurement_type: 'reps', garmin_exercise_category: 'BANDED_EXERCISES', garmin_exercise_name: 'ROW', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'single_leg_glute_bridge', display_name: 'Single-Leg Glute Bridge', aliases: ['single leg glute bridge', 'one-leg glute bridge', 'single-leg hip raise'], measurement_type: 'reps', garmin_exercise_category: 'HIP_RAISE', garmin_exercise_name: 'SINGLE_LEG_HIP_RAISE', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'standing_calf_raise', display_name: 'Standing Calf Raise', aliases: ['calf raise', 'calf raises'], measurement_type: 'reps', garmin_exercise_category: 'CALF_RAISE', garmin_exercise_name: 'STANDING_CALF_RAISE', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'single_leg_calf_raise', display_name: 'Single-Leg Calf Raise', aliases: ['single leg calf raise', 'one-leg calf raise'], measurement_type: 'reps', garmin_exercise_category: 'CALF_RAISE', garmin_exercise_name: 'SINGLE_LEG_STANDING_CALF_RAISE', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'banded_clamshell', display_name: 'Banded Clamshell', aliases: ['clamshell', 'clam shell', 'banded clamshells', 'banded clam'], measurement_type: 'reps', garmin_exercise_category: 'BANDED_EXERCISES', garmin_exercise_name: 'CLAM_SHELLS', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'banded_side_step', display_name: 'Banded Side-Step', aliases: ['banded side-steps', 'lateral band walk', 'monster walk', 'crab walk'], measurement_type: 'reps', garmin_exercise_category: 'BANDED_EXERCISES', garmin_exercise_name: 'LATERAL_BAND_WALKS', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'banded_hamstring_curl', display_name: 'Banded Hamstring Curl', aliases: ['band hamstring curl'], measurement_type: 'reps', garmin_exercise_category: 'BANDED_EXERCISES', garmin_exercise_name: 'HAMSTRING_CURLS', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'single_leg_hamstring_slider', display_name: 'Single-Leg Hamstring Slider', aliases: ['single-leg eccentric hamstring slider', 'single leg slider hamstring curl', 'hamstring slider', 'sliding leg curl'], measurement_type: 'reps', garmin_exercise_category: 'LEG_CURL', garmin_exercise_name: 'SLIDING_LEG_CURL', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'suitcase_carry', display_name: 'Suitcase Carry', aliases: ['suitcase walk', 'single-arm carry'], measurement_type: 'duration', garmin_exercise_category: 'CARRY', garmin_exercise_name: 'CARRY', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'rear_foot_elevated_split_squat', display_name: 'Rear-Foot-Elevated Split Squat', aliases: ['rfess', 'bulgarian split squat', 'rear foot elevated split squat'], measurement_type: 'reps', garmin_exercise_category: 'LUNGE', garmin_exercise_name: 'BACK_FOOT_ELEVATED_DUMBBELL_SPLIT_SQUAT', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'feet_elevated_push_up', display_name: 'Feet-Elevated Push-up', aliases: ['feet elevated pushup', 'decline push-up', 'decline pushup'], measurement_type: 'reps', garmin_exercise_category: 'PUSH_UP', garmin_exercise_name: 'DECLINE_PUSH_UP', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'dead_bug_with_reach', display_name: 'Dead Bug with Reach', aliases: ['dead bug reach'], measurement_type: 'reps', garmin_exercise_category: 'HIP_STABILITY', garmin_exercise_name: 'DEAD_BUG', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'dead_bug_with_dumbbell_overhead', display_name: 'Dead Bug with Dumbbell Overhead', aliases: ['weighted dead bug', 'dead bug with weight'], measurement_type: 'reps', garmin_exercise_category: 'HIP_STABILITY', garmin_exercise_name: 'WEIGHTED_DEAD_BUG', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: 'side_lying_abduction', display_name: 'Side-Lying Abduction', aliases: ['side-lying abduction isometric', 'side-lying abduction with dumbbell', 'side lying leg raise', 'side-lying leg raise', 'side-lying hip abduction'], measurement_type: 'reps', garmin_exercise_category: 'HIP_STABILITY', garmin_exercise_name: 'SIDE_LYING_LEG_RAISE', garmin_step_type: 'STRENGTH', garmin_supported: true },
  { canonical_name: '90_90_hip_rotation', display_name: '90/90 Hip Rotation', aliases: ['90 90 hip rotation', '9090 hip rotation', '90/90 hip rotations'], measurement_type: 'reps', garmin_exercise_category: 'WARM_UP', garmin_exercise_name: 'STRETCH_90_90', garmin_step_type: 'OTHER', garmin_supported: true },
  { canonical_name: 'plank_complex', display_name: 'Plank Complex', aliases: ['plank series', 'plank sequence'], measurement_type: 'duration', garmin_exercise_category: 'PLANK', garmin_exercise_name: 'PLANK', garmin_step_type: 'STRENGTH', garmin_supported: true },
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
