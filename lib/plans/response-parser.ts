import { addDays, parseISO, format } from 'date-fns'

export interface ParsedWorkout {
  day: number
  workout_index: string
  type: string
  description: string   // populated server-side by enrichParsedWorkouts if not in LLM output
  distance_meters: number | null
  intensity: string
  pace_guidance: string | null
  notes: string | null
  structured_workout?: Record<string, unknown> | null
}

export interface PreWeekWorkout {
  type: string
  distance_km?: number
  intensity: string
  description: string
  pace_guidance?: string | null
  notes?: string | null
  structured_workout?: Record<string, unknown> | null
}

export interface ParsedWeek {
  week_number: number
  phase: string | null
  weekly_total_km: number
  workouts: ParsedWorkout[]
}

export interface ParsedPlan {
  weeks: ParsedWeek[]
  preWeekWorkouts?: PreWeekWorkout[]
}

/**
 * Parse and validate LLM JSON response
 */
export function parseLLMResponse(responseText: string): ParsedPlan {
  // Remove markdown code blocks if present
  let cleanJson = responseText.trim()
  if (cleanJson.startsWith('```json')) {
    cleanJson = cleanJson.replace(/```json\n?/, '').replace(/\n?```$/, '')
  } else if (cleanJson.startsWith('```')) {
    cleanJson = cleanJson.replace(/```\n?/, '').replace(/\n?```$/, '')
  }

  // Parse JSON
  let parsed: any
  try {
    parsed = JSON.parse(cleanJson)
  } catch (error) {
    throw new Error(`Invalid JSON response: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }

  // Validate structure
  if (!parsed.weeks || !Array.isArray(parsed.weeks)) {
    throw new Error('Response missing "weeks" array')
  }

  // Parse and validate pre_week_workouts if present
  let preWeekWorkouts: PreWeekWorkout[] | undefined
  if (parsed.pre_week_workouts && Array.isArray(parsed.pre_week_workouts)) {
    preWeekWorkouts = parsed.pre_week_workouts.map((workout: any, index: number) => {
      if (!workout.type || typeof workout.type !== 'string') {
        throw new Error(`Pre-week workout ${index + 1} missing or invalid type`)
      }
      if (!workout.description) {
        throw new Error(`Pre-week workout ${index + 1} missing description`)
      }
      if (!workout.intensity) {
        throw new Error(`Pre-week workout ${index + 1} missing intensity`)
      }
      return {
        type: workout.type,
        distance_km: workout.distance_km || workout.distance_meters ? (workout.distance_meters / 1000) : undefined,
        intensity: workout.intensity,
        description: workout.description,
        pace_guidance: workout.pace_guidance || null,
        notes: workout.notes || null
      }
    })
  }

  // Validate each week
  for (const week of parsed.weeks) {
    if (typeof week.week_number !== 'number') {
      throw new Error(`Week missing week_number: ${JSON.stringify(week)}`)
    }

    if (!Array.isArray(week.workouts)) {
      throw new Error(`Week ${week.week_number} missing workouts array`)
    }

    // Validate each workout
    for (const workout of week.workouts) {
      if (typeof workout.day !== 'number' || workout.day < 1 || workout.day > 7) {
        throw new Error(`Invalid day in week ${week.week_number}: ${workout.day}`)
      }

      if (!workout.workout_index || !workout.workout_index.match(/^W\d+:D\d+$/)) {
        throw new Error(`Invalid workout_index in week ${week.week_number}: ${workout.workout_index}`)
      }

      if (!workout.type || typeof workout.type !== 'string') {
        throw new Error(`Missing or invalid type in workout ${workout.workout_index}`)
      }

      if (!workout.description) {
        // LLM occasionally omits description — generate a fallback rather than failing the plan
        const typeLabel: Record<string, string> = {
          easy_run: 'Easy run', recovery: 'Recovery run', long_run: 'Long run',
          tempo: 'Tempo run', intervals: 'Intervals', rest: 'Rest day',
          cross_training: 'Cross training', race: 'Race day',
        }
        const label = typeLabel[workout.type?.toLowerCase()] ?? workout.type ?? 'Workout'
        workout.description = workout.distance_meters
          ? `${label} ${(workout.distance_meters / 1000).toFixed(1)} km`
          : label
        console.warn(`Workout ${workout.workout_index} missing description — generated fallback: "${workout.description}"`)
      }

      // Warn if interval workout is missing structured main_set (tempo is generated server-side)
      if (workout.type === 'intervals') {
        const hasMainSet = workout.structured_workout?.main_set &&
          Array.isArray(workout.structured_workout.main_set)
        if (!hasMainSet) {
          console.warn(`Workout ${workout.workout_index} (intervals) missing structured_workout.main_set`)
        }
      }
    }
  }

  return {
    weeks: parsed.weeks,
    preWeekWorkouts
  }
}

/**
 * Calculate workout date from week start and day
 * Uses date-fns to avoid timezone issues with Date arithmetic
 */
export function calculateWorkoutDate(weekStartDate: Date | string, day: number): string {
  // day: 1=Monday, 7=Sunday
  // Parse the date properly to avoid timezone issues
  const startDate = typeof weekStartDate === 'string'
    ? parseISO(weekStartDate)
    : parseISO(weekStartDate.toISOString().split('T')[0])

  // Add days using date-fns (0-indexed: day 1 = start date, day 2 = start + 1 day, etc.)
  const workoutDate = addDays(startDate, day - 1)

  // Format as YYYY-MM-DD
  return format(workoutDate, 'yyyy-MM-dd')
}

/**
 * Get phase name from week number
 */
export function inferPhase(weekNumber: number, totalWeeks: number): string {
  const progress = weekNumber / totalWeeks

  if (progress <= 0.25) {
    return 'base'
  } else if (progress <= 0.70) {
    return 'build'
  } else if (progress <= 0.85) {
    return 'peak'
  } else {
    return 'taper'
  }
}
