-- Adds session_order to support same-date split runs ("Run 1" / "Run 2" doubles).
-- Default 1 backfills all existing rows as single-session-per-date.
-- No UNIQUE (athlete_id, scheduled_date, session_order) constraint: the only
-- writer producing session_order > 1 is the split endpoint, which deletes-then-
-- inserts in sequence; legacy/plan-apply paths keep default 1.

ALTER TABLE planned_workouts
  ADD COLUMN session_order INT NOT NULL DEFAULT 1;

CREATE INDEX idx_planned_workouts_athlete_date_order
  ON planned_workouts (athlete_id, scheduled_date, session_order);
