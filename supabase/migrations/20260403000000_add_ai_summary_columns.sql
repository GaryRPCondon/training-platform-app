-- AI Activity Summary feature: add summary, description, and push columns

-- Activities: AI summary fields
ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS ai_summary TEXT,
  ADD COLUMN IF NOT EXISTS ai_summary_status TEXT DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS ai_summary_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_star_rating NUMERIC(2,1);

-- Activities: Description snapshots (read at sync/match time)
ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS garmin_description TEXT,
  ADD COLUMN IF NOT EXISTS strava_description TEXT;

-- Activities: Push tracking (schema only — no push logic in this implementation)
ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS garmin_summary_pushed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS strava_summary_pushed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS garmin_push_failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS strava_push_failed_at TIMESTAMPTZ;

-- Constraints
ALTER TABLE activities
  ADD CONSTRAINT ai_summary_status_values
  CHECK (ai_summary_status IN ('none', 'pending', 'generated', 'failed'));

ALTER TABLE activities
  ADD CONSTRAINT ai_star_rating_range
  CHECK (ai_star_rating IS NULL OR (ai_star_rating >= 0.0 AND ai_star_rating <= 5.0 AND ai_star_rating * 2 = FLOOR(ai_star_rating * 2)));

-- Athletes: AI summary master toggle and push opt-in (all default to off)
ALTER TABLE athletes
  ADD COLUMN IF NOT EXISTS ai_summaries_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS push_summary_to_garmin BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS push_summary_to_strava BOOLEAN DEFAULT false;
