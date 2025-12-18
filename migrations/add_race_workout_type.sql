-- Migration: Add 'race' workout type
-- Date: 2025-12-18
-- Description: Adds 'race' as a valid workout_type for goal race day workouts
-- This replaces the previous workaround of using 'tempo' for race days

-- Drop existing constraint
ALTER TABLE planned_workouts
  DROP CONSTRAINT IF EXISTS planned_workouts_workout_type_check;

-- Add new constraint with 'race' included
ALTER TABLE planned_workouts
  ADD CONSTRAINT planned_workouts_workout_type_check
  CHECK (workout_type IN (
    'easy_run',
    'long_run',
    'intervals',
    'tempo',
    'rest',
    'cross_training',
    'recovery',
    'race'
  ));

-- Optional: Add comment for documentation
COMMENT ON CONSTRAINT planned_workouts_workout_type_check ON planned_workouts
  IS 'Enforces valid workout types: easy_run, long_run, intervals, tempo, rest, cross_training, recovery, race';
