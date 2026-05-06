-- Add feedback_tone column to athletes table.
-- Controls the framing/emphasis of AI activity summaries:
--   critical  — lead with shortfalls, unsparing
--   balanced  — current behaviour (default)
--   positive  — lead with strengths, reinforce wins

ALTER TABLE athletes
  ADD COLUMN feedback_tone TEXT NOT NULL DEFAULT 'balanced'
  CHECK (feedback_tone IN ('critical', 'balanced', 'positive'));
