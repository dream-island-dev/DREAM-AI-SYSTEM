-- =============================================================================
-- 089_bot_config_authenticated_read.sql
-- "CTO AUDIT" session — closes a real RLS gap found while auditing security.
--
-- migration 015 created `bot_config_read` as `FOR SELECT USING (true)` —
-- with no auth.uid() check at all, unlike bot_settings_read / the bot_scripts
-- read policy / guests_read, which all correctly require an authenticated
-- session. Result: bot_config (bot persona, hotel knowledge, response rules)
-- has been readable with just the public anon key, no login required, since
-- migration 015. migration 087's cleaner-lockdown RESTRICTIVE policy does
-- NOT close this — it only blocks role='cleaner'; an anonymous request has
-- no role at all, so get_true_role() returns NULL, COALESCE(...,'') <>
-- 'cleaner' is true, and the restrictive policy lets it straight through.
--
-- FIX: replace the permissive read policy with the same auth.uid() IS NOT
-- NULL gate every other bot_* table already uses. Write policy (admin-only)
-- is untouched.
-- =============================================================================

DROP POLICY IF EXISTS bot_config_read ON public.bot_config;

CREATE POLICY bot_config_read ON public.bot_config
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

COMMENT ON POLICY bot_config_read ON public.bot_config IS
  'Tightened from migration 015''s USING (true) — that was genuinely public/anon-readable (no session required), unlike bot_settings/bot_scripts/guests which all require auth.uid() IS NOT NULL. Write policy (bot_config_write, admin/super_admin only) is unchanged.';
