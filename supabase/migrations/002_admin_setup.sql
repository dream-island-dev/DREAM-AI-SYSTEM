-- ================================================================
-- Migration 002: Admin Role Setup
-- Auto-promotes promote7il@gmail.com to admin on signup/login.
-- Run AFTER 001_chat_history.sql.
-- ================================================================

-- ── 1. Update new-user trigger to detect admin email ─────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_role TEXT;
  v_name TEXT;
BEGIN
  v_name := COALESCE(
    NEW.raw_user_meta_data->>'name',
    split_part(NEW.email, '@', 1)
  );

  -- Auto-promote known admin email
  IF NEW.email = 'promote7il@gmail.com' THEN
    v_role := 'admin';
  ELSE
    v_role := COALESCE(NEW.raw_user_meta_data->>'role', 'manager');
  END IF;

  INSERT INTO public.profiles (id, name, email, role, avatar_text)
  VALUES (
    NEW.id,
    v_name,
    NEW.email,
    v_role,
    LEFT(UPPER(v_name), 2)
  )
  ON CONFLICT (id) DO UPDATE SET
    role       = CASE
                   WHEN EXCLUDED.email = 'promote7il@gmail.com' THEN 'admin'
                   ELSE profiles.role
                 END,
    updated_at = NOW();

  RETURN NEW;
END;
$$;

-- ── 2. Helper to manually promote any existing user to admin ─────────────────
CREATE OR REPLACE FUNCTION public.promote_to_admin(p_email TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE public.profiles
  SET role = 'admin', updated_at = NOW()
  WHERE email = p_email;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count = 0 THEN
    RETURN 'User not found — they must sign in once before promotion.';
  END IF;

  RETURN 'Promoted ' || p_email || ' to admin.';
END;
$$;

-- Promote the admin email right now (handles case where they already signed up)
SELECT public.promote_to_admin('promote7il@gmail.com');

-- ── 3. Admin-override RLS policies (admin bypasses all restrictions) ──────────

-- profiles: admin reads & writes everything
DROP POLICY IF EXISTS "admin_profiles_all" ON public.profiles;
CREATE POLICY "admin_profiles_all" ON public.profiles
  FOR ALL
  USING     (get_my_role() = 'admin')
  WITH CHECK (get_my_role() = 'admin');

-- agent_profiles: admin reads & writes all agents
DROP POLICY IF EXISTS "admin_agent_profiles_all" ON public.agent_profiles;
CREATE POLICY "admin_agent_profiles_all" ON public.agent_profiles
  FOR ALL
  USING     (get_my_role() = 'admin')
  WITH CHECK (get_my_role() = 'admin');

-- questionnaire_responses: admin reads all
DROP POLICY IF EXISTS "admin_questionnaire_all" ON public.questionnaire_responses;
CREATE POLICY "admin_questionnaire_all" ON public.questionnaire_responses
  FOR ALL
  USING     (get_my_role() = 'admin')
  WITH CHECK (get_my_role() = 'admin');

-- conversation_history: admin reads all
DROP POLICY IF EXISTS "admin_conversation_all" ON public.conversation_history;
CREATE POLICY "admin_conversation_all" ON public.conversation_history
  FOR ALL
  USING     (get_my_role() = 'admin')
  WITH CHECK (get_my_role() = 'admin');

-- agent_learning_logs: admin reads all
DROP POLICY IF EXISTS "admin_learning_logs_all" ON public.agent_learning_logs;
CREATE POLICY "admin_learning_logs_all" ON public.agent_learning_logs
  FOR ALL
  USING     (get_my_role() = 'admin')
  WITH CHECK (get_my_role() = 'admin');

-- chat_history: keep open (mock-auth compatible); admin explicit policy
DROP POLICY IF EXISTS "admin_chat_history_all" ON public.chat_history;
CREATE POLICY "admin_chat_history_all" ON public.chat_history
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- ── 4. Grant admin view of all users ────────────────────────────────────────
-- Useful for the Admin Panel's user list
CREATE OR REPLACE VIEW public.admin_user_summary AS
SELECT
  p.id,
  p.name,
  p.email,
  p.role,
  p.department,
  p.created_at,
  ap.display_name   AS agent_name,
  ap.department     AS agent_dept,
  ap.is_active      AS agent_active,
  (SELECT COUNT(*) FROM public.chat_history ch WHERE ch.manager_id = p.id::TEXT) AS total_messages
FROM public.profiles p
LEFT JOIN public.agent_profiles ap ON ap.manager_id = p.id;

-- ================================================================
-- END OF MIGRATION 002
-- ================================================================
