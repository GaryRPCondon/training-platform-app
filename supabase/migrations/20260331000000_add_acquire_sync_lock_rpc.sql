-- Atomic sync lock acquisition to prevent concurrent Garmin/Strava sync races.
-- Only acquires if no lock exists or existing lock is stale (older than threshold).
CREATE OR REPLACE FUNCTION public.acquire_sync_lock(
  p_athlete_id UUID,
  p_stale_threshold TIMESTAMPTZ
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rows_updated INT;
BEGIN
  UPDATE athletes
  SET sync_locked_at = NOW()
  WHERE id = p_athlete_id
    AND (sync_locked_at IS NULL OR sync_locked_at <= p_stale_threshold);

  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RETURN rows_updated > 0;
END;
$$;
