-- Address Supabase Security Advisor warnings (2026-05-27).
--
-- 1. Pin search_path on SECURITY DEFINER functions that lacked it, to prevent
--    search-path hijacking via objects in other schemas.
-- 2. Revoke EXECUTE on internal RPC functions from anon/public so they are
--    not callable via /rest/v1/rpc/* without authentication. authenticated
--    keeps access because is_own_athlete is referenced in RLS policies and
--    acquire_sync_lock is invoked from server-side API routes.

ALTER FUNCTION public.acquire_sync_lock(uuid, timestamptz)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.get_dashboard_stats(uuid, text, text)
  SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.acquire_sync_lock(uuid, timestamptz) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_own_athlete(uuid) FROM anon, public;

GRANT EXECUTE ON FUNCTION public.acquire_sync_lock(uuid, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_own_athlete(uuid) TO authenticated, service_role;
