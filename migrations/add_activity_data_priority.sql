-- Add activity data priority preference to athletes table
-- This controls which source's data (name, type, etc.) takes priority when merging activities

ALTER TABLE athletes
ADD COLUMN IF NOT EXISTS preferred_activity_data_source TEXT DEFAULT 'most_recent';

-- Add check constraint for valid values
ALTER TABLE athletes DROP CONSTRAINT IF EXISTS athletes_preferred_activity_data_source_check;
ALTER TABLE athletes ADD CONSTRAINT athletes_preferred_activity_data_source_check
  CHECK (preferred_activity_data_source IN ('strava', 'garmin', 'most_recent'));

-- Add column comment
COMMENT ON COLUMN athletes.preferred_activity_data_source IS
  'Priority for activity details when merging: strava, garmin, or most_recent (default)';
