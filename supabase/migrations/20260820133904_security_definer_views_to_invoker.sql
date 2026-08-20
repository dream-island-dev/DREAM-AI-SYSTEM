-- 310_security_definer_views_to_invoker.sql
-- Overnight hardening (2026-08-20), part 6 -- caught by Supabase's own
-- security advisor (get_advisors), not by file-reading.
--
-- admin_user_summary and chat_sessions_summary are views that run with
-- their owner's privileges (Postgres default when no security_invoker
-- option is set) -- they bypass RLS on the underlying tables entirely, and
-- both were still directly SELECT-able by anon. This completely undermined
-- the 306/308 chat_history RLS fix: anyone with just the public anon key
-- could read chat_sessions_summary (every manager's last chat message,
-- unauthenticated) and admin_user_summary (every staff member's name,
-- email, role, department -- full staff directory, unauthenticated).
--
-- Fix: security_invoker = true makes each view respect the RLS of the
-- table(s) it selects from, evaluated as the actual querying role -- so
-- chat_sessions_summary now inherits chat_history's owner/admin policy,
-- and admin_user_summary inherits profiles' (auth.uid() = id OR
-- get_my_role() = 'admin') policy. Anon grants also explicitly revoked as
-- defense in depth.

ALTER VIEW public.admin_user_summary SET (security_invoker = true);
ALTER VIEW public.chat_sessions_summary SET (security_invoker = true);

REVOKE ALL ON public.admin_user_summary FROM anon;
REVOKE ALL ON public.chat_sessions_summary FROM anon;
