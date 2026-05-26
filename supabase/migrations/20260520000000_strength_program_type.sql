-- Replace `cadence_days` with `program_type` + `weeks_to_repeat`.
--
-- The original schema baked in a per-session cadence ("every N days") which
-- collapses two different real-world program shapes into one:
--   - Full plan: every session of every week is written out (place each once).
--   - Weekly routine: one week of sessions to repeat for N weeks.
--
-- The new model makes that distinction explicit at import time. The user
-- picks which shape they're pasting; the wizard branches on it; the
-- scheduler expands sessions accordingly.

ALTER TABLE strength_programs
  ADD COLUMN program_type text NOT NULL DEFAULT 'fixed'
    CHECK (program_type IN ('fixed', 'weekly')),
  ADD COLUMN weeks_to_repeat integer
    CHECK (weeks_to_repeat IS NULL OR (weeks_to_repeat BETWEEN 1 AND 52));

-- The existing column is dropped. There are no production rows yet; if there
-- were we'd back-fill program_type='weekly' with weeks_to_repeat derived from
-- cadence_days first.
ALTER TABLE strength_programs DROP COLUMN cadence_days;

-- Constraint: weekly programs must have a repeat count.
ALTER TABLE strength_programs
  ADD CONSTRAINT strength_programs_weekly_requires_weeks
  CHECK (program_type = 'fixed' OR weeks_to_repeat IS NOT NULL);
