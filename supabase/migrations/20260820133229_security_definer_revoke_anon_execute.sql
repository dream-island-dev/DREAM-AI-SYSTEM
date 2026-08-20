-- 307_security_definer_revoke_anon_execute.sql
-- Follow-up to 305: REVOKE ALL ... FROM PUBLIC does not touch a role's own
-- direct grant. anon still held EXECUTE on all 5 functions via Supabase's
-- default-privileges auto-grant at function creation time. Body-level
-- auth.uid() IS NULL checks already block anonymous callers functionally,
-- but the grant itself should match intent too (defense in depth).

REVOKE EXECUTE ON FUNCTION public.delete_guest_profile(BIGINT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.match_guest_fuzzy(TEXT, DATE) FROM anon;
REVOKE EXECUTE ON FUNCTION public.swap_spa_therapists(BIGINT, BIGINT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.suppress_guest_pipeline_stage(BIGINT, TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.unsuppress_guest_pipeline_stage(BIGINT, TEXT) FROM anon;
