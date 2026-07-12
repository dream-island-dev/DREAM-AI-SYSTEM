-- =============================================================================
-- 189_pre_arrival_2d_session_script_wire.sql
-- Stage 1 Whapi catch-up failed live (2026-07-12): all 14 bulk sends returned
-- whapi_session_unavailable because automation_stages.session_message_script_key
-- for pre_arrival_2d was NULL — bot_scripts.pre_arrival_2d still exists (migration
-- 100 seeded both). Re-wire the hybrid column so force_channel=whapi_session can
-- load the free-text body. Idempotent; does not touch is_active or Meta template.
-- =============================================================================

UPDATE public.automation_stages
SET session_message_script_key = 'pre_arrival_2d'
WHERE stage_key = 'pre_arrival_2d'
  AND (session_message_script_key IS NULL OR session_message_script_key = '');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.bot_scripts WHERE script_key = 'pre_arrival_2d'
      AND COALESCE(trim(message_text), '') <> ''
  ) THEN
    RAISE EXCEPTION '189_self_test: bot_scripts.pre_arrival_2d missing or empty';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.automation_stages
    WHERE stage_key = 'pre_arrival_2d'
      AND session_message_script_key = 'pre_arrival_2d'
  ) THEN
    RAISE EXCEPTION '189_self_test: pre_arrival_2d session_message_script_key not wired';
  END IF;
END $$;
