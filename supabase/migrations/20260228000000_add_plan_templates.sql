-- Stores marathon training plan templates (migrated from public/templates/)
CREATE TABLE plan_templates (
  id                      SERIAL PRIMARY KEY,
  template_id             TEXT UNIQUE NOT NULL,          -- e.g. "hal_higdon_novice_2_marathon"
  name                    TEXT NOT NULL,
  author                  TEXT NOT NULL,
  methodology             TEXT NOT NULL,                 -- e.g. "Hal", "Pfitzinger", "Luke"
  duration_weeks          INTEGER NOT NULL,
  training_days_per_week  INTEGER NOT NULL,
  peak_mileage_km         FLOAT NOT NULL,
  peak_mileage_miles      FLOAT NOT NULL,
  difficulty_score        INTEGER NOT NULL,
  experience_level        TEXT NOT NULL,                 -- e.g. "novice", "intermediate", "advanced"
  catalog_summary         JSONB NOT NULL,                -- full TemplateSummary object
  full_template           JSONB NOT NULL,                -- full FullTemplate object
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_plan_templates_methodology ON plan_templates(methodology);
CREATE INDEX idx_plan_templates_experience  ON plan_templates(experience_level);

-- RLS: templates are shared reference data, readable by all authenticated users
ALTER TABLE plan_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read plan templates"
  ON plan_templates FOR SELECT TO authenticated USING (true);
-- No INSERT/UPDATE/DELETE policies — writes only via service role (seed script)
