-- Add sync_on_login preference to athletes table
ALTER TABLE athletes ADD COLUMN sync_on_login boolean NOT NULL DEFAULT false;
