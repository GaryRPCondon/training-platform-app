-- Phase 6: Activity Matching and Completion Tracking
-- Add metadata columns for activity-workout linking

-- Add matching metadata to activities table
ALTER TABLE activities
ADD COLUMN IF NOT EXISTS match_confidence FLOAT,
ADD COLUMN IF NOT EXISTS match_method TEXT,
ADD COLUMN IF NOT EXISTS match_metadata JSONB;

-- Add completion tracking to planned_workouts table
ALTER TABLE planned_workouts
ADD COLUMN IF NOT EXISTS completion_status TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS completion_metadata JSONB;

-- Constraints
ALTER TABLE planned_workouts DROP CONSTRAINT IF EXISTS check_completion_status;
ALTER TABLE planned_workouts ADD CONSTRAINT check_completion_status
CHECK (completion_status IN ('pending', 'completed', 'partial', 'skipped'));

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_activities_match_confidence
ON activities(match_confidence) WHERE match_confidence IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_planned_workouts_completion
ON planned_workouts(athlete_id, completion_status, scheduled_date);

-- Foreign key constraints for bidirectional linking
-- Drop existing constraints if they exist
ALTER TABLE activities DROP CONSTRAINT IF EXISTS fk_activities_planned_workout;
ALTER TABLE planned_workouts DROP CONSTRAINT IF EXISTS fk_planned_workouts_completed_activity;

-- Add foreign key from activities to planned_workouts
ALTER TABLE activities
ADD CONSTRAINT fk_activities_planned_workout
FOREIGN KEY (planned_workout_id)
REFERENCES planned_workouts(id)
ON DELETE SET NULL;

-- Add foreign key from planned_workouts to activities
ALTER TABLE planned_workouts
ADD CONSTRAINT fk_planned_workouts_completed_activity
FOREIGN KEY (completed_activity_id)
REFERENCES activities(id)
ON DELETE SET NULL;

-- Column comments for documentation
COMMENT ON COLUMN activities.match_confidence IS 'Confidence score 0.0-1.0 for auto-matched workouts';
COMMENT ON COLUMN activities.match_method IS 'auto_time | auto_distance | manual';
COMMENT ON COLUMN activities.match_metadata IS 'Metadata about the match (time_diff, distance_diff, etc.)';
COMMENT ON COLUMN planned_workouts.completion_status IS 'pending | completed | partial | skipped';
COMMENT ON COLUMN planned_workouts.completion_metadata IS 'Actual performance data (distance, duration, variance)';
