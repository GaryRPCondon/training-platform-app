-- Add is_demo flag to athletes.
--
-- Marks the single shared public demo account. The demo athlete is a writable
-- sandbox populated nightly from the owner's live data (wipe + reclone) and is
-- subject to server-side guards: restricted routes, a shared daily LLM budget,
-- and exclusion from background jobs (e.g. push-summaries) so it never incurs
-- surprise spend.
--
-- Server code pins the demo auth user id in DEMO_USER_ID and checks it via
-- isDemoUser() (lib/demo/demo.ts); this column is the client-visible signal
-- (read through the athlete row) used to render demo-mode UI.
--
-- Existing rows default to false — no athlete becomes a demo account implicitly.

ALTER TABLE athletes
  ADD COLUMN is_demo BOOLEAN NOT NULL DEFAULT false;
