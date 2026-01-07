export interface StravaTokens {
    access_token: string
    refresh_token: string
    expires_at: number
    expires_in: number
    athlete?: {
        id: number
        username: string
        firstname: string
        lastname: string
    }
}

export interface StravaActivity {
    id: number
    name: string
    distance: number
    moving_time: number
    elapsed_time: number
    total_elevation_gain: number
    type: string
    sport_type?: string  // e.g., "Run", "TrailRun", "VirtualRun"
    workout_type?: number | null  // Integer: 0=Default, 1=Race, 2=Long Run, 3=Workout (for runs)
    start_date: string
    start_date_local: string
    timezone: string
    utc_offset: number
    start_latlng: [number, number] | null
    end_latlng: [number, number] | null
    map: {
        id: string
        summary_polyline: string
        resource_state: number
    }
    trainer: boolean
    commute: boolean
    manual: boolean
    private: boolean
    flagged: boolean
    gear_id: string | null
    average_speed: number
    max_speed: number
    average_cadence?: number
    average_heartrate?: number
    max_heartrate?: number
    elev_high?: number
    elev_low?: number
    pr_count?: number
    total_photo_count?: number
    has_kudoed?: boolean
}

export interface StravaRateLimit {
    short: { usage: number; limit: number }
    long: { usage: number; limit: number }
}
