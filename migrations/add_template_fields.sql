-- Phase 2: Add template and workout indexing fields
-- Run this migration before implementing Phase 2

-- Add template tracking to training_plans
ALTER TABLE training_plans
ADD COLUMN IF NOT EXISTS template_id TEXT,
ADD COLUMN IF NOT EXISTS template_version TEXT DEFAULT '1.0',
ADD COLUMN IF NOT EXISTS user_criteria JSONB;

-- Add workout indexing to planned_workouts
ALTER TABLE planned_workouts
ADD COLUMN IF NOT EXISTS workout_index TEXT;

-- Add index for workout lookups
CREATE INDEX IF NOT EXISTS idx_planned_workouts_index
ON planned_workouts(weekly_plan_id, workout_index);

-- Add status values for draft states (if not already present)
-- Note: This may need adjustment based on your existing enum definition
-- If status is a CHECK constraint rather than enum, modify accordingly
DO $$
BEGIN
    -- Check if we're using enum type
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'training_plan_status') THEN
        -- Add new enum values if they don't exist
        ALTER TYPE training_plan_status ADD VALUE IF NOT EXISTS 'draft_generated';
    END IF;
END$$;

COMMENT ON COLUMN training_plans.template_id IS 'Reference to template in public/templates/ (e.g., "pfitz_55_18")';
COMMENT ON COLUMN training_plans.template_version IS 'Template version for compatibility tracking';
COMMENT ON COLUMN training_plans.user_criteria IS 'User criteria used for generation (weeks, mileage, experience, etc.)';
COMMENT ON COLUMN planned_workouts.workout_index IS 'Unique workout identifier in format W{week}:D{day} (e.g., W1:D1, W12:D5)';
