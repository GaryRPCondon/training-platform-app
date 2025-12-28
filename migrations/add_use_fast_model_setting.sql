-- Add use_fast_model_for_operations column to athletes table
-- This setting controls whether to use non-reasoning models (e.g., deepseek-chat)
-- for quick plan modifications instead of slower reasoning models (e.g., deepseek-reasoner)

ALTER TABLE athletes
ADD COLUMN IF NOT EXISTS use_fast_model_for_operations BOOLEAN DEFAULT true;

-- Add comment
COMMENT ON COLUMN athletes.use_fast_model_for_operations IS 'Use non-reasoning model for quick operations (default: true)';
