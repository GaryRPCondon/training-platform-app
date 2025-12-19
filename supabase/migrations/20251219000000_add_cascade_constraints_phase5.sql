-- Migration: Add CASCADE constraints for Phase 5 plan regeneration
-- Date: 2025-12-19
-- Purpose: Prevent orphaned records when regenerating plan weeks

-- CRITICAL: This migration must be run before Phase 5 implementation
-- Without these constraints, regenerating plans will leave orphaned records in:
-- - chat_sessions (broken chat history)
-- - plan_adjustments (old adjustments remain)
-- - workout_flags (flags become orphaned)
-- - workout_feedback (feedback becomes orphaned)

-- ============================================================================
-- 1. CHAT SESSIONS CASCADE
-- ============================================================================

-- Drop existing foreign key constraints if they exist
ALTER TABLE chat_sessions
  DROP CONSTRAINT IF EXISTS chat_sessions_weekly_plan_id_fkey;

ALTER TABLE chat_sessions
  DROP CONSTRAINT IF EXISTS chat_sessions_specific_workout_id_fkey;

-- Add CASCADE constraints
ALTER TABLE chat_sessions
  ADD CONSTRAINT chat_sessions_weekly_plan_id_fkey
    FOREIGN KEY (weekly_plan_id)
    REFERENCES weekly_plans(id)
    ON DELETE CASCADE;

ALTER TABLE chat_sessions
  ADD CONSTRAINT chat_sessions_specific_workout_id_fkey
    FOREIGN KEY (specific_workout_id)
    REFERENCES planned_workouts(id)
    ON DELETE CASCADE;

-- ============================================================================
-- 2. PLAN ADJUSTMENTS CASCADE
-- ============================================================================

-- Drop existing foreign key constraints if they exist
ALTER TABLE plan_adjustments
  DROP CONSTRAINT IF EXISTS plan_adjustments_weekly_plan_id_fkey;

ALTER TABLE plan_adjustments
  DROP CONSTRAINT IF EXISTS plan_adjustments_original_workout_id_fkey;

-- Add CASCADE constraints
ALTER TABLE plan_adjustments
  ADD CONSTRAINT plan_adjustments_weekly_plan_id_fkey
    FOREIGN KEY (weekly_plan_id)
    REFERENCES weekly_plans(id)
    ON DELETE CASCADE;

ALTER TABLE plan_adjustments
  ADD CONSTRAINT plan_adjustments_original_workout_id_fkey
    FOREIGN KEY (original_workout_id)
    REFERENCES planned_workouts(id)
    ON DELETE CASCADE;

-- ============================================================================
-- 3. WORKOUT FLAGS CASCADE
-- ============================================================================

-- Drop existing foreign key constraint if it exists
ALTER TABLE workout_flags
  DROP CONSTRAINT IF EXISTS workout_flags_planned_workout_id_fkey;

-- Add CASCADE constraint
ALTER TABLE workout_flags
  ADD CONSTRAINT workout_flags_planned_workout_id_fkey
    FOREIGN KEY (planned_workout_id)
    REFERENCES planned_workouts(id)
    ON DELETE CASCADE;

-- ============================================================================
-- 4. WORKOUT FEEDBACK CASCADE
-- ============================================================================

-- Drop existing foreign key constraint if it exists
ALTER TABLE workout_feedback
  DROP CONSTRAINT IF EXISTS workout_feedback_planned_workout_id_fkey;

-- Add CASCADE constraint
ALTER TABLE workout_feedback
  ADD CONSTRAINT workout_feedback_planned_workout_id_fkey
    FOREIGN KEY (planned_workout_id)
    REFERENCES planned_workouts(id)
    ON DELETE CASCADE;

-- ============================================================================
-- VERIFICATION QUERIES (Run after migration to verify)
-- ============================================================================

-- Check that constraints were created successfully
-- You can run these queries to verify the migration worked:

-- SELECT conname, contype, confupdtype, confdeltype
-- FROM pg_constraint
-- WHERE conrelid IN (
--   'chat_sessions'::regclass,
--   'plan_adjustments'::regclass,
--   'workout_flags'::regclass,
--   'workout_feedback'::regclass
-- )
-- AND contype = 'f';  -- Foreign key constraints only

-- Expected output should show confdeltype = 'c' (CASCADE) for all 6 constraints:
--   1. chat_sessions_weekly_plan_id_fkey
--   2. chat_sessions_specific_workout_id_fkey
--   3. plan_adjustments_weekly_plan_id_fkey
--   4. plan_adjustments_original_workout_id_fkey
--   5. workout_flags_planned_workout_id_fkey
--   6. workout_feedback_planned_workout_id_fkey

-- ============================================================================
-- ROLLBACK SCRIPT (In case you need to revert)
-- ============================================================================

-- To rollback, drop CASCADE constraints and re-add without CASCADE:
--
-- ALTER TABLE chat_sessions DROP CONSTRAINT chat_sessions_weekly_plan_id_fkey;
-- ALTER TABLE chat_sessions ADD CONSTRAINT chat_sessions_weekly_plan_id_fkey
--   FOREIGN KEY (weekly_plan_id) REFERENCES weekly_plans(id);
--
-- (Repeat for all 6 constraints)
