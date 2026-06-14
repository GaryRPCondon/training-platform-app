-- Performance indexes (code review P3.8)
--
-- 1) training_plans(athlete_id, status): the hottest plan lookup is
--    "find this athlete's active plan" (status = 'active'), done on nearly
--    every dashboard/calendar/agent request. Currently only the PK is indexed.
-- 2) weekly_plans(phase_id): foreign key to training_phases with no index,
--    so phase->weeks joins do a sequential scan.

CREATE INDEX IF NOT EXISTS idx_training_plans_athlete_status
  ON public.training_plans USING btree (athlete_id, status);

CREATE INDEX IF NOT EXISTS idx_weekly_plans_phase_id
  ON public.weekly_plans USING btree (phase_id);
