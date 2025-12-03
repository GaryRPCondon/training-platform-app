-- Add week_starts_on column to athletes table
-- This allows users to customize which day their week starts on in the calendar
-- 0 = Sunday, 1 = Monday, 6 = Saturday

ALTER TABLE athletes
ADD COLUMN IF NOT EXISTS week_starts_on INTEGER DEFAULT 0;

COMMENT ON COLUMN athletes.week_starts_on IS 'Day of week the calendar starts on: 0=Sunday, 1=Monday, 6=Saturday';

-- Set Monday as default for existing European users (optional)
-- UPDATE athletes SET week_starts_on = 1 WHERE timezone LIKE 'Europe%';
