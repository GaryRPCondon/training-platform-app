export interface PlanWorkout {
  day?: number
  workout_index?: string
  type: string
  description: string
  distance_meters?: number | null
  intensity: string
  pace_guidance?: string | null
  notes?: string | null
  duration_seconds?: number | null
  structured_workout?: Record<string, unknown> | null
}

export interface CalEvent {
  id: string
  title: string
  start: Date
  end: Date
  type: string
  workout: PlanWorkout
}
