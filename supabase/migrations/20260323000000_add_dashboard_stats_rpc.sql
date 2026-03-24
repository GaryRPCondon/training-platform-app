-- RPC function to compute dashboard stats in a single query (no row transfer)
CREATE OR REPLACE FUNCTION get_dashboard_stats(
    p_athlete_id UUID,
    p_year_start TEXT,
    p_plan_start TEXT DEFAULT NULL
)
RETURNS JSON AS $$
    SELECT json_build_object(
        'total_distance', COALESCE(SUM(distance_meters), 0),
        'total_count', COUNT(*),
        'year_distance', COALESCE(SUM(CASE WHEN start_time >= p_year_start::timestamptz THEN distance_meters ELSE 0 END), 0),
        'year_climb', COALESCE(SUM(CASE WHEN start_time >= p_year_start::timestamptz THEN elevation_gain_meters ELSE 0 END), 0),
        'plan_distance', COALESCE(SUM(CASE WHEN p_plan_start IS NOT NULL AND start_time >= p_plan_start::timestamptz THEN distance_meters ELSE 0 END), 0)
    )
    FROM activities
    WHERE athlete_id = p_athlete_id
      AND activity_type IN ('running', 'Run');
$$ LANGUAGE sql STABLE;
