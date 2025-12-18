import type { PlannedWorkout, WeeklyPlan, TrainingPhase } from './database'

// Calendar event for react-big-calendar
export interface WorkoutEvent {
  id: number
  title: string
  start: Date
  end: Date
  resource: WorkoutWithDetails
}

// Extended planned workout with computed fields
export interface WorkoutWithDetails extends PlannedWorkout {
  date: Date
  formatted_date: string
  phase_name: string
  week_of_plan: number
  validation_warning?: {
    message: string
    expectedRange: { min: number; max: number }
    actualDistance: number
  }
}

// Week view data structure
export interface WeekViewData {
  week_number: number
  week_start: Date
  week_end: Date
  phase: string
  workouts: WorkoutWithDetails[]
  weekly_volume: number
  weekly_plan_id: number
}

// Plan review context
export interface PlanReviewContext {
  plan_id: number
  plan_name: string
  goal_date: string
  goal_type: string
  template_name: string
  status: string
  total_weeks: number
  current_week: number
  vdot: number | null
  training_paces: {
    easy: number
    marathon: number
    tempo: number
    interval: number
    repetition: number
  } | null
  phases: TrainingPhase[]
  weeks: WeekViewData[]
}

// Chat message for review session
export interface ReviewMessage {
  id: number
  role: 'user' | 'assistant' | 'system'
  content: string
  created_at: string
  metadata?: {
    referenced_workouts?: string[]  // e.g., ["W4:D2", "W5:D3"]
    action_taken?: string
  }
}
