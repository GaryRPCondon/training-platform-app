-- Add admin flag, account status, and profile completion tracking
ALTER TABLE athletes
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS account_status TEXT DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS profile_completed BOOLEAN DEFAULT false;

-- Add check constraint for valid account statuses
ALTER TABLE athletes
  ADD CONSTRAINT check_valid_account_status
  CHECK (account_status IN ('pending_approval', 'approved', 'suspended'));

-- Set existing athletes to approved and profile completed (don't lock them out)
UPDATE athletes SET account_status = 'approved' WHERE account_status IS NULL;
UPDATE athletes SET profile_completed = true WHERE profile_completed IS NULL;

-- Fix workout_flags missing CASCADE (blocks account deletion without this)
ALTER TABLE workout_flags DROP CONSTRAINT IF EXISTS workout_flags_athlete_id_fkey;
ALTER TABLE workout_flags ADD CONSTRAINT workout_flags_athlete_id_fkey
  FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE;

-- Set admin flag manually after migration:
-- UPDATE athletes SET is_admin = true WHERE email = 'your-email@example.com';
