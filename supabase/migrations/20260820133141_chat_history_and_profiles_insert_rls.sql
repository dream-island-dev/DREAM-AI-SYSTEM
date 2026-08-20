-- 306_chat_history_and_profiles_insert_rls.sql
-- Overnight hardening (2026-08-20), part 3.
--
-- 1. chat_history_open (migration 001) was created with USING (true) and no
--    TO authenticated clause — anyone holding only the public anon key can
--    read/write/delete every manager's AI chat history with zero session.
--    Confirmed live: real production usage (AgentChat.js:143) already sends
--    manager_id = auth.uid() for every real logged-in user, so scoping to
--    owner (+ admin/super_admin for oversight) does not break the feature.
--    A handful of pre-existing mock/test rows (manager_id = "test" or a raw
--    timestamp string) become unreachable — they were never reachable by any
--    real authenticated identity anyway, so nothing currently working is
--    affected.
--
-- 2. profiles_insert_trigger (migration 003) is WITH CHECK (true), no TO
--    authenticated — the comment says it's "for the SECURITY DEFINER
--    trigger", but handle_new_auth_user is itself SECURITY DEFINER and
--    bypasses RLS entirely, so this client-facing policy was never actually
--    needed for that. The one real caller is UserManagement.js's "undo
--    delete" re-insert (line 559), gated client-side to canEdit =
--    isSuperAdmin(currentUser) only. Tightened to match that actual, sole
--    legitimate use instead of allowing anyone (including anon) to insert
--    arbitrary rows into profiles.

DROP POLICY IF EXISTS "chat_history_open" ON public.chat_history;

CREATE POLICY "chat_history_owner_or_admin" ON public.chat_history
  FOR ALL
  TO authenticated
  USING (
    manager_id = auth.uid()::text
    OR COALESCE(public.get_true_role(), '') IN ('admin', 'super_admin')
  )
  WITH CHECK (
    manager_id = auth.uid()::text
    OR COALESCE(public.get_true_role(), '') IN ('admin', 'super_admin')
  );

DROP POLICY IF EXISTS "profiles_insert_trigger" ON public.profiles;

CREATE POLICY "profiles_insert_super_admin_only" ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (COALESCE(public.get_true_role(), '') = 'super_admin');
