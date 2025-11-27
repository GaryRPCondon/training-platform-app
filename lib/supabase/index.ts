// Core types matching database schema
export interface Athlete {
  id: string
  email: string
  name: string | null
  date_of_birth: string | null
  preferred_units: 'metric' | 'imperial'
  timezone: string | null
  created_at: string
}

export interface Activity {
  id: number
  athlete_id: string
  garmin_id: number | null
  strava_id: number | null
  source: string
  activity_name: string | null
  activity_type: string | null
  start_time: string
  distance_meters: number | null
  duration_seconds: number | null
  // ... add other fields as needed
}

export interface PlannedWorkout {
  id: number
  weekly_plan_id: number
  athlete_id: string
  scheduled_date: string
  scheduled_time: string | null
  workout_type: string
  description: string | null
  distance_target_meters: number | null
  duration_target_seconds: number | null
  status: 'scheduled' | 'completed' | 'skipped' | 'rescheduled'
  // ... add other fields as needed
}

// Add more types as you build features