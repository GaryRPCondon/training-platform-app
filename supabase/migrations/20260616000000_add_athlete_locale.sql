-- Add locale column to athletes table.
-- Stores the athlete's preferred UI language as the canonical source of truth.
-- The NEXT_LOCALE cookie (read by next-intl) is hydrated from this value in
-- proxy.ts, so the preference follows the user across devices.
--
-- 'en'    — English (default)
-- 'en-XA' — accented LTR pseudo-locale (dev/QA verification)
-- 'en-XB' — bidi RTL pseudo-locale (dev/QA verification)

ALTER TABLE athletes
  ADD COLUMN locale TEXT NOT NULL DEFAULT 'en';
