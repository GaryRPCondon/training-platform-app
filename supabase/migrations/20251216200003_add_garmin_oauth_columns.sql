-- Migration: Add OAuth1/OAuth2 columns for Garmin dual-token auth
-- Date: 2026-01-07
--
-- Garmin uses both OAuth1 (long-lived) and OAuth2 (short-lived) tokens
-- This schema update adds columns to store both token types

-- Add new columns
ALTER TABLE athlete_integrations
ADD COLUMN IF NOT EXISTS oauth1_token TEXT,
ADD COLUMN IF NOT EXISTS oauth2_token TEXT;

-- Add comments for documentation
COMMENT ON COLUMN athlete_integrations.oauth1_token IS 'OAuth1 token JSON (Garmin only) - long-lived ~1 year';
COMMENT ON COLUMN athlete_integrations.oauth2_token IS 'OAuth2 token JSON - short-lived, auto-refreshed';

-- Verification query (run separately to confirm)
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'athlete_integrations'
-- ORDER BY ordinal_position;
