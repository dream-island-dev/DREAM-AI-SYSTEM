-- =============================================================================
-- 112_xos_ai_rules_update_delete.sql
-- Allow staff to edit/delete learned rules from BotSettings.js (admin UI).
-- INSERT/SELECT already exist (migration 103); cleaner lockdown unchanged.
-- =============================================================================

CREATE POLICY "xos_ai_rules_authed_update" ON public.xos_ai_rules
  FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "xos_ai_rules_authed_delete" ON public.xos_ai_rules
  FOR DELETE
  USING (auth.uid() IS NOT NULL);
