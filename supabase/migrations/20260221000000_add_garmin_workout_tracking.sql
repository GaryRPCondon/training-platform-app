-- Add Garmin workout tracking columns to planned_workouts
-- Allows tracking which workouts have been sent to Garmin Connect,
-- enabling updates instead of creating duplicates on re-send.
--
-- garmin_sync_status values:
--   NULL     = not sent to Garmin
--   'synced' = sent successfully and up to date
--   'stale'  = workout modified after being sent (needs re-send)
--   'failed' = last send attempt failed

ALTER TABLE planned_workouts
  ADD COLUMN IF NOT EXISTS garmin_workout_id TEXT,
  ADD COLUMN IF NOT EXISTS garmin_scheduled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS garmin_sync_status TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_planned_workouts_garmin
  ON planned_workouts(garmin_workout_id)
  WHERE garmin_workout_id IS NOT NULL;
