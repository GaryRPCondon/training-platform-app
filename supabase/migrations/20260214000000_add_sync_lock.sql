-- Add sync lock column to athletes table
-- Used to prevent concurrent sync operations for the same athlete
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS sync_locked_at timestamptz DEFAULT NULL;
