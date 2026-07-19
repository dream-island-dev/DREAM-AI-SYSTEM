-- Migration 230: Named agent personas (נועה/מאיה/ליאת) + Eliad morning pulse opening line.
-- Syncs existing DB rows with the new code defaults (ELIAD_DIGEST_SHELL_DEFAULTS in
-- staffNotifyTemplates.ts, DEFAULT_PERSONA_TEMPLATE in executiveAssistant.ts) so
-- rows created by earlier migrations (216) don't keep serving the old anonymous wording.
-- Guarded so it only rewrites rows still holding the old text — safe to re-run.

UPDATE public.staff_message_templates
SET digest_config = COALESCE(digest_config, '{}'::jsonb) || jsonb_build_object(
      'opening_line', 'בוקר טוב {{name}} · נועה, העוזרת האישית שלך',
      'footer_pulse', 'שאל «מה קורה?» לעדכון חי · «דוח שבועי» לסיכום מלא'
    ),
    updated_at = NOW()
WHERE template_key = 'eliad_digest_shell'
  AND (digest_config->>'opening_line') IS DISTINCT FROM 'בוקר טוב {{name}} · נועה, העוזרת האישית שלך';

-- Shared executive persona prompt: add the {{assistant_name}} token so each
-- executive/architect/front_desk profile introduces itself by its own name
-- (resolved per-profile in buildExecutivePersona, executiveAssistant.ts).
UPDATE public.executive_bot_settings
SET persona_prompt = replace(
      persona_prompt,
      'אני העוזרת האישית של {{name}}',
      'אני {{assistant_name}}, העוזרת האישית של {{name}}'
    ),
    updated_at = NOW()
WHERE id = 1
  AND persona_prompt LIKE '%אני העוזרת האישית של {{name}}%'
  AND persona_prompt NOT LIKE '%{{assistant_name}}%';
