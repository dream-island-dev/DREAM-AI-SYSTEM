-- 308_tasks_and_chat_history_close_anon_permissive.sql
-- Overnight hardening (2026-08-20), part 4 -- found by inspecting LIVE
-- pg_policy state directly (not just migration files, which do not reflect
-- every policy that exists in production today).
--
-- 1. tasks: tasks_insert / tasks_select / tasks_update are permissive
--    policies scoped to role "public" (not "authenticated") with
--    USING/CHECK true -- anyone holding only the public anon key can
--    insert/read/update any row in the operational tasks table (guest
--    names, rooms, request descriptions) with zero session. The one public
--    magic-link consumer (task-action Edge Function) already uses the
--    service-role key, which bypasses RLS entirely -- these anon-open
--    grants serve no legitimate purpose. Narrowed to "authenticated" only;
--    the USING/CHECK logic (true) is unchanged, matching the same
--    "any authenticated staff" pattern already used everywhere else in this
--    app (guests, bookings, etc.) -- not a new, stricter model.
--
-- 2. chat_history: admin_chat_history_all (added after migration 001, not
--    present in any file audited) is a PERMISSIVE policy with USING/CHECK
--    literally "true", scoped to role "public". Permissive policies are
--    OR'd, so this alone made the 306 migration's owner/admin-scoped
--    "chat_history_owner_or_admin" policy a no-op -- the table remained
--    fully open to anon regardless. Dropped; chat_history_owner_or_admin
--    (owner OR admin/super_admin, from migration 306) already covers the
--    legitimate "admin sees all conversations" intent this policy's name
--    implied, correctly scoped to real authenticated admins this time.

ALTER POLICY tasks_insert ON public.tasks TO authenticated;
ALTER POLICY tasks_select ON public.tasks TO authenticated;
ALTER POLICY tasks_update ON public.tasks TO authenticated;

DROP POLICY IF EXISTS "admin_chat_history_all" ON public.chat_history;
