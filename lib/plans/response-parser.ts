export interface ParsedWorkout {
  day: number
  workout_index: string
  type: string
  description: string
  distance_meters: number | null
  duration_minutes: number | null
  intensity: string
  pace_guidance: string | null
  notes: string | null
}

export interface ParsedWeek {
  week_number: number
  phase: string | null
  weekly_total_km: number
  workouts: ParsedWorkout[]
}

export interface ParsedPlan {
  weeks: ParsedWeek[]
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
        throw new Error(`Missing description in workout ${workout.workout_index}`)
      }
    }
  }

  return parsed as ParsedPlan
}

/**
 * Calculate workout date from week start and day
 */
export function calculateWorkoutDate(weekStartDate: Date, day: number): string {
  // day: 1=Monday, 7=Sunday
  const workoutDate = new Date(weekStartDate)
  workoutDate.setDate(workoutDate.getDate() + (day - 1))
  return workoutDate.toISOString().split('T')[0]
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
