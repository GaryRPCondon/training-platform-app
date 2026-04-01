// Template catalog types
export interface TemplateCatalog {
  catalog_version: string
  last_updated: string
  description: string
  total_plans: number
  plans: TemplateSummary[]
}

export interface TemplateSummary {
  template_id: string
  name: string
  author: string
  methodology: string
  source_file: string
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
  weekly_schedule: WeekSchedule[]
}

export interface WeekSchedule {
  week: number
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
}

// Recommendation types
export interface UserCriteria {
  experience_level: 'first_marathon' | 'beginner' | 'intermediate' | 'advanced'
  current_weekly_mileage: number  // km
  comfortable_peak_mileage: number  // km
  days_per_week: number
  weeks_available: number
  preferred_methodology?: string  // 'any' | 'hal' | 'pfitzinger' | 'hansons' | 'daniels' | 'magness'
  force_methodology?: boolean  // If true, only show preferred_methodology
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
}

export interface RecommendationResponse {
  recommendations: TemplateRecommendation[]
  total_considered: number
  filtered_out: number
  criteria_used: UserCriteria
}
