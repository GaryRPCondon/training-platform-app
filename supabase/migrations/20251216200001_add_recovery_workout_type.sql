-- Add 'recovery' to the workout_type check constraint
-- This allows proper differentiation between easy runs and recovery runs

-- First, drop the existing check constraint
ALTER TABLE planned_workouts DROP CONSTRAINT IF EXISTS planned_workouts_workout_type_check;

-- Recreate the constraint with 'recovery' included
ALTER TABLE planned_workouts ADD CONSTRAINT planned_workouts_workout_type_check
  CHECK (workout_type IN ('easy_run', 'long_run', 'intervals', 'tempo', 'rest', 'cross_training', 'recovery'));

-- Update the column comment for documentation
COMMENT ON COLUMN planned_workouts.workout_type IS
'Type of workout: easy_run, long_run, intervals, tempo, rest, cross_training, recovery.
Recovery runs are slower/easier than easy runs, typically done day after hard workouts.';
