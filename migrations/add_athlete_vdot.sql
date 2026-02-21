-- Add VDOT and training pace columns to athletes table
-- Allows storing performance metrics independently of training plans
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS vdot DECIMAL(4,1);
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS training_paces JSONB;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS pace_source TEXT;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS pace_source_data JSONB;
