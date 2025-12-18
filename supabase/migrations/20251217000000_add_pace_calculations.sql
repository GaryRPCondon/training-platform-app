-- ============================================================================
-- Add VDOT and Training Pace Calculations to Training Plans
-- ============================================================================

-- Add columns to store pace calculations per plan
ALTER TABLE training_plans
ADD COLUMN IF NOT EXISTS vdot DECIMAL(4,1),  -- e.g., 50.5
ADD COLUMN IF NOT EXISTS training_paces JSONB,  -- Store all calculated paces
ADD COLUMN IF NOT EXISTS pace_source TEXT,  -- 'vdot_direct', 'race_time_5k', 'race_time_10k', etc.
ADD COLUMN IF NOT EXISTS pace_source_data JSONB;  -- Original input data for reference

-- Add comments
COMMENT ON COLUMN training_plans.vdot IS 'Calculated VDOT value for this plan (Jack Daniels formula)';
COMMENT ON COLUMN training_plans.training_paces IS 'Calculated training paces: {"easy": 330, "marathon": 285, "tempo": 270, "interval": 245, "repetition": 230} (seconds/km)';
COMMENT ON COLUMN training_plans.pace_source IS 'How VDOT was determined: vdot_direct, race_time_5k, race_time_10k, race_time_10_mile, race_time_half_marathon, race_time_marathon';
COMMENT ON COLUMN training_plans.pace_source_data IS 'Original input: {"vdot": 50.5} or {"race_distance": "10k", "race_time": "40:00", "race_time_seconds": 2400}';

-- Example data structure for training_paces:
-- {
--   "easy": 330,        -- 5:30/km
--   "marathon": 285,    -- 4:45/km
--   "tempo": 270,       -- 4:30/km
--   "interval": 245,    -- 4:05/km
--   "repetition": 230   -- 3:50/km
-- }

-- Example data structure for pace_source_data:
-- Direct VDOT: {"vdot": 50.5}
-- Race time: {"race_distance": "10k", "race_time": "40:00", "race_time_seconds": 2400, "calculated_vdot": 51.5}
