export interface Athlete {
    id: string
    email: string
    name: string | null
    date_of_birth: string | null
    gender: string | null
    max_hr: number | null
    resting_hr: number | null
    threshold_pace: number | null // min/km
    threshold_power: number | null // watts
    vo2_max: number | null
    preferred_units: 'metric' | 'imperial'
    week_starts_on: number | null // 0 = Sunday, 1 = Monday
    timezone: string | null
    garmin_connected: boolean
    strava_connected: boolean
    preferred_llm_provider: 'anthropic' | 'openai' | 'gemini' | 'deepseek' | 'grok'
    preferred_llm_model: string | null
    use_fast_model_for_operations: boolean // Use non-reasoning model for quick operations
    created_at: string
    updated_at: string
}

export interface AthleteIntegration {
    id: number
    athlete_id: string
    platform: 'garmin' | 'strava'
    platform_athlete_id: string | null
    connected_at: string
    last_synced_at: string | null
}

export interface AthleteConstraint {
    id: number
    athlete_id: string
    constraint_type: 'pace_limit' | 'injury_history' | 'preference' | 'scheduling'
    constraint_data: any
    active: boolean
    created_from_chat_id: number | null
    created_at: string
    updated_at: string
}

export interface Activity {
    id: number
    athlete_id: string
    garmin_id: number | null
    strava_id: number | null
    source: 'garmin' | 'strava' | 'merged' | 'manual'
    activity_name: string | null
    activity_type: string | null
    start_time: string
    distance_meters: number | null
    duration_seconds: number | null
    moving_duration_seconds: number | null
    elevation_gain_meters: number | null
    elevation_loss_meters: number | null
    avg_hr: number | null
    max_hr: number | null
    min_hr: number | null
    avg_power: number | null
    max_power: number | null
    normalized_power: number | null
    avg_cadence: number | null
    max_cadence: number | null
    calories: number | null
    perceived_effort: number | null
    notes: string | null
    planned_workout_id: number | null
    garmin_data: any | null
    strava_data: any | null
    synced_from_garmin: string | null
    synced_from_strava: string | null
    // Merge tracking (virtual fields or stored in metadata/JSONB in real DB)
    merge_status?: 'pending_review' | 'merged' | 'auto_merged' | 'ignored'
    confidence_score?: number
    created_at: string
}

export interface AthleteGoal {
    id: number
    athlete_id: string
    goal_type: 'race' | 'distance' | 'time' | 'consistency'
    goal_name: string
    target_date: string | null
    target_value: any | null
    status: 'active' | 'completed' | 'abandoned'
    priority: number
    created_at: string
    completed_at: string | null
}

export interface TrainingPlan {
    id: number
    athlete_id: string
    goal_id: number | null
    name: string
    start_date: string
    end_date: string
    plan_type: string | null
    status: 'draft' | 'draft_generated' | 'active' | 'completed' | 'paused'
    created_by: string | null
    template_id: string | null
    template_version: string | null
    user_criteria: any | null
    vdot: number | null
    training_paces: TrainingPaces | null
    pace_source: string | null
    pace_source_data: any | null
    created_at: string
    updated_at: string
}

export interface TrainingPaces {
    easy: number          // seconds per km
    marathon: number
    tempo: number
    interval: number
    repetition: number
}

export interface TrainingPhase {
    id: number
    plan_id: number
    phase_name: string
    phase_order: number
    start_date: string
    end_date: string
    weekly_volume_target: number | null
    max_weekly_volume: number | null
    max_long_run_distance: number | null
    intensity_distribution: any | null
    scheduling_preferences: any | null
    description: string | null
}

export interface WeeklyPlan {
    id: number
    phase_id: number | null
    athlete_id: string
    week_start_date: string
    week_number: number | null
    weekly_volume_target: number | null
    weekly_load_target: number | null
    status: 'planned' | 'in_progress' | 'completed'
    agent_rationale: string | null
    agent_decision_metadata: any | null
    notes: string | null
    created_at: string
    updated_at: string
}

export interface PlannedWorkout {
    id: number
    weekly_plan_id: number | null
    athlete_id: string
    scheduled_date: string
    scheduled_time: string | null
    workout_type: 'easy_run' | 'long_run' | 'intervals' | 'tempo' | 'rest' | 'cross_training' | 'recovery' | 'race'
    workout_index: string | null
    description: string | null
    distance_target_meters: number | null
    duration_target_seconds: number | null
    intensity_target: string | null
    structured_workout: any | null
    status: 'scheduled' | 'completed' | 'skipped' | 'rescheduled'
    completed_activity_id: number | null
    agent_rationale: string | null
    agent_decision_metadata: any | null
    notes: string | null
    version: number
    created_at: string
    updated_at: string
}

export interface WorkoutFeedback {
    id: number
    athlete_id: string
    planned_workout_id: number | null
    activity_id: number | null
    felt_difficulty: number | null
    compared_to_plan: 'easier' | 'as_expected' | 'harder' | null
    injury_concern: boolean
    injury_description: string | null
    fatigue_level: number | null
    sleep_quality: number | null
    what_worked_well: string | null
    what_didnt_work: string | null
    feedback_text: string | null
    created_at: string
}

export interface PlanAdjustment {
    id: number
    athlete_id: string
    weekly_plan_id: number | null
    adjustment_reason: string
    original_workout_id: number | null
    adjustment_type: 'reschedule' | 'modify' | 'skip' | 'add'
    agent_recommended: boolean
    adjusted_at: string
    notes: string | null
}

export interface WorkoutFlag {
    id: number
    planned_workout_id: number | null
    activity_id: number | null
    flag_type: string
    severity: 'info' | 'warning' | 'concern'
    flag_data: any
    acknowledged: boolean
    created_at: string
}

export interface PhaseProgress {
    id: number
    phase_id: number
    week_number: number
    planned_volume_km: number | null
    actual_volume_km: number | null
    volume_gap_km: number | null
    planned_workouts_by_type: any | null
    actual_workouts_by_type: any | null
    missing_workout_types: any | null
    gap_severity: string | null
    catch_up_possible: boolean | null
    computed_at: string
}

export interface HealthMetric {
    id: number
    athlete_id: string
    date: string
    sleep_score: number | null
    sleep_duration_minutes: number | null
    resting_hr: number | null
    hrv: number | null
    body_battery: number | null
    stress_avg: number | null
    readiness_score: number | null
    steps: number | null
    weight_kg: number | null
    raw_data: any | null
    created_at: string
}

export interface ChatSession {
    id: number
    athlete_id: string
    session_type: 'weekly_planning' | 'workout_modification' | 'feedback' | 'general'
    weekly_plan_id: number | null
    specific_workout_id: number | null
    context: any | null
    started_at: string
    ended_at: string | null
}

export interface ChatMessage {
    id: number
    session_id: number
    role: 'user' | 'assistant' | 'system'
    content: string
    provider: string | null
    model: string | null
    token_usage: any | null
    action_taken: any | null
    metadata: any | null
    created_at: string
}

export interface SyncLog {
    id: number
    athlete_id: string
    source: 'garmin' | 'strava'
    sync_type: 'activities' | 'health'
    last_synced_at: string
    records_fetched: number | null
    status: 'success' | 'partial' | 'failed'
    error_message: string | null
    created_at: string
}
