// Template catalog types
export interface TemplateCatalog {
  catalog_version: string
  last_updated: string
  description: string
  total_plans: number
  plans: TemplateSummary[]
}

export type RaceDistance = '5k' | '10k' | 'half_marathon' | 'marathon'

export interface SourceReference {
  book_title?: string       // e.g. "Faster Road Racing"
  book_url?: string         // e.g. Amazon link
  website_url?: string      // e.g. "https://www.halhigdon.com/..."
  pacing_guidance_note: string  // e.g. "Consult the book for VDOT pace tables"
}

export interface TemplateSummary {
  template_id: string
  name: string
  author: string
  methodology: string
  distance: RaceDistance  // Race distance this template targets
  source_file: string
  source_reference?: SourceReference
  characteristics: {
    duration_weeks: number
    training_days_per_week: number
    peak_weekly_mileage: {
      miles: number
      km: number
    }
    difficulty_score: number
    structure_type: string
  }
  target_audience: {
    experience_level: string
    prerequisites: string[]
    training_commitment: string
  }
  philosophy: {
    approach: string
    key_features: string[]
    description_short: string
  }
  tags: string[]
  suitable_for: {
    good_fit: string[]
    not_recommended: string[]
  }
}

// Full template structure (loaded from source files)
export interface FullTemplate {
  template_id: string
  name: string
  author: string
  methodology: string
  distance: RaceDistance  // Race distance this template targets
  source_reference?: SourceReference
  duration_weeks: number
  training_days_per_week: number
  peak_weekly_mileage: {
    miles: number
    km: number
  }
  target_audience: {
    experience_level: string
    prerequisites: string[]
  }
  philosophy: {
    approach: string
    key_features: string[]
  }
  pace_targets?: Record<string, PaceTarget>
  validation_ranges: Record<string, { min: number; max: number }>
  weekly_schedule: WeekSchedule[]
  weekly_schedule_units?: string
  weekly_schedule_contract?: string
  workout_notation?: Record<string, string>
  race_week?: RaceWeekGuidance
}

export interface RaceWeekGuidance {
  day_before_race: 'rest' | 'easy_shakeout' | 'easy_shakeout_with_strides'
  shakeout_distance_meters?: number
  volume_pct_of_peak?: number
  guidance: string
  _note?: string
}

export interface WeekSchedule {
  week: number
  plan_week?: number  // 1=first training week (chronological) — present when template uses countdown week numbering
  phase?: string
  workouts?: Record<string, WorkoutDetail>  // Hal/Jack structure
  monday?: string    // Magness/Hansons/Pfitz structure
  tuesday?: string
  wednesday?: string
  thursday?: string
  friday?: string
  saturday?: string
  sunday?: string
  weekly_total?: {
    miles?: number
    km?: number
  }
  // JD 2Q style per-week targets (in miles + pre-computed km companions)
  Q1_km?: number
  Q2_km?: number
  E_days_total_km?: number
  total_km?: number
}

export interface WorkoutDetail {
  type: string
  distance?: {
    miles?: number
    km?: number
  }
  description?: string
  intensity?: string
  pace?: string
}

// Pace target types (methodology-specific intensity → athlete pace mapping)
export interface PaceTarget {
  reference_pace: string           // key into AllTrainingPaces (e.g. "easy", "race_5k")
  offset_sec_per_km?: number       // negative=faster, positive=slower. Default 0
  reference_pace_upper?: string    // for range targets (e.g. Pfitz LT: race_15k → race_half_marathon)
  description: string              // human-readable, shown in coach prompt
  prescription?: 'distance' | 'time'  // default 'distance'. 'time' → LLM emits duration_seconds + distance_meters:null
}

// Recommendation types
export interface UserCriteria {
  goal_type: RaceDistance  // The race distance being trained for
  experience_level: 'complete_beginner' | 'beginner' | 'intermediate' | 'advanced'
  current_weekly_mileage: number  // km (always metric internally)
  comfortable_peak_mileage: number  // km (always metric internally)
  days_per_week: number
  weeks_available: number
  preferred_rest_days?: number[]  // Days of week (0=Sunday, 1=Monday, etc.) for preferred rest days
}

export interface TemplateRecommendation {
  template_id: string
  name: string
  author: string
  methodology: string
  fit_score: number  // 0-100
  reasoning: {
    mileage_fit: string
    experience_match: string
    schedule_match: string
    buildup_assessment: string
  }
  characteristics: TemplateSummary['characteristics']
  match_quality: 'excellent' | 'good' | 'fair'
  source_reference?: SourceReference
}

export interface RecommendationResponse {
  recommendations: TemplateRecommendation[]
  total_considered: number
  filtered_out: number
  criteria_used: UserCriteria
}
