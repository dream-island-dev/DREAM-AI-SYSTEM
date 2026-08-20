-- 20260820174200_reapply_security_definer_views_to_invoker.sql
-- During the 2026-08-20 platform outage investigation, migration 310's
-- `ALTER VIEW ... SET (security_invoker = true)` was reverted as a
-- troubleshooting attempt (it was not the cause -- root cause was a
-- Supabase-side PostgREST/compute issue, confirmed separately: two sibling
-- projects were unaffected, no DDL ran in the trigger window, Supabase's own
-- status page documented a matching PostgREST GLIBC incident, and the
-- project's compute graph showed CPU 97% / Disk IO 100%). The revert was
-- never re-applied afterward, leaving admin_user_summary and
-- chat_sessions_summary back in owner-privilege mode: any authenticated
-- user (not just admins) could see every staff member's name/email/role and
-- every manager's chat history again, bypassing the underlying tables' RLS.
-- Re-applying the fix from 310. Live-verified: anon still gets permission
-- denied on both views; general API health unaffected.

ALTER VIEW public.admin_user_summary SET (security_invoker = true);
ALTER VIEW public.chat_sessions_summary SET (security_invoker = true);
