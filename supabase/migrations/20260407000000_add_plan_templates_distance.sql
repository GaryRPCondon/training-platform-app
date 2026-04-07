-- Add distance column to plan_templates table
-- Existing marathon templates default to 'marathon'; new 5K/10K/half templates will set distance explicitly

ALTER TABLE plan_templates
ADD COLUMN IF NOT EXISTS distance TEXT DEFAULT 'marathon';

COMMENT ON COLUMN plan_templates.distance IS 'Race distance: 5k, 10k, half_marathon, marathon';

-- Update existing marathon catalog_summary JSONB to include "distance": "marathon"
UPDATE plan_templates
SET catalog_summary = catalog_summary || '{"distance": "marathon"}'::jsonb
WHERE distance = 'marathon';
