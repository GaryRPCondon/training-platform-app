-- Add enriched columns to laps table (existing table has 10 base columns already)
ALTER TABLE laps ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'garmin';
ALTER TABLE laps ADD COLUMN IF NOT EXISTS split_type TEXT;        -- e.g. 'WARMUP', 'ACTIVE', 'COOLDOWN', 'RECOVERY'
ALTER TABLE laps ADD COLUMN IF NOT EXISTS intensity_type TEXT;    -- Garmin intensityType (same field, kept separate for future flexibility)
ALTER TABLE laps ADD COLUMN IF NOT EXISTS avg_cadence FLOAT;
ALTER TABLE laps ADD COLUMN IF NOT EXISTS max_speed FLOAT;        -- m/s
ALTER TABLE laps ADD COLUMN IF NOT EXISTS normalized_power FLOAT;
ALTER TABLE laps ADD COLUMN IF NOT EXISTS ground_contact_time FLOAT;  -- ms
ALTER TABLE laps ADD COLUMN IF NOT EXISTS stride_length FLOAT;        -- cm
ALTER TABLE laps ADD COLUMN IF NOT EXISTS vertical_oscillation FLOAT; -- mm
ALTER TABLE laps ADD COLUMN IF NOT EXISTS wkt_step_index INTEGER; -- links lap to planned workout step
ALTER TABLE laps ADD COLUMN IF NOT EXISTS compliance_score INTEGER;   -- Garmin directWorkoutComplianceScore (0-100)

-- Index for loading all laps for an activity efficiently
CREATE INDEX IF NOT EXISTS idx_laps_activity_id ON laps(activity_id);

-- Add detail metadata columns to activities table
ALTER TABLE activities ADD COLUMN IF NOT EXISTS hr_zones JSONB;
-- Format: [{"zone": 0, "secsInZone": 381, "zoneLowBoundary": 0}, ...]
ALTER TABLE activities ADD COLUMN IF NOT EXISTS has_detail_data BOOLEAN DEFAULT false;
