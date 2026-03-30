-- Add first_name and last_name fields to athletes table
-- Split the existing 'name' field into separate first/last name fields

ALTER TABLE athletes
ADD COLUMN IF NOT EXISTS first_name TEXT,
ADD COLUMN IF NOT EXISTS last_name TEXT;

-- Add column comments
COMMENT ON COLUMN athletes.first_name IS 'Athlete first name';
COMMENT ON COLUMN athletes.last_name IS 'Athlete last name';
COMMENT ON COLUMN athletes.name IS 'Legacy full name field (deprecated, use first_name/last_name)';
