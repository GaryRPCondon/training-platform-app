-- Migration: Add preferred_llm_model to athletes table
-- Description: Allows users to specify a custom model name for their selected LLM provider

ALTER TABLE athletes 
ADD COLUMN IF NOT EXISTS preferred_llm_model TEXT;

COMMENT ON COLUMN athletes.preferred_llm_model IS 'Custom model name override (e.g., claude-3-5-sonnet-20240620)';
