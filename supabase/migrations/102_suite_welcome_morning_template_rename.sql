-- Migration 102: Align live DB template names with Meta-approved suite_welcome_morning
-- Fixes Meta error #132001 (template name does not exist / not approved) when the
-- runtime was still sending the deprecated dream_welcome_morning token.

UPDATE public.automation_stages
SET meta_template_name = 'suite_welcome_morning'
WHERE meta_template_name = 'dream_welcome_morning'
   OR stage_key IN ('morning_suite', 'morning_welcome');

UPDATE public.bot_scripts
SET meta_template_name = 'suite_welcome_morning'
WHERE meta_template_name = 'dream_welcome_morning';

-- message_templates.wa_template_name exists only when migration 025 was applied.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'message_templates'
      AND column_name = 'wa_template_name'
  ) THEN
    UPDATE public.message_templates
    SET wa_template_name = 'suite_welcome_morning'
    WHERE wa_template_name = 'dream_welcome_morning';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.automation_stages
    WHERE stage_key IN ('morning_suite', 'morning_welcome')
      AND meta_template_name = 'suite_welcome_morning'
  ) THEN
    RAISE EXCEPTION 'migration 102 self-test failed: morning_suite/morning_welcome not on suite_welcome_morning';
  END IF;
END $$;
