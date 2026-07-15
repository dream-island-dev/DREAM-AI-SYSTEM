-- Migration 217: Morning brief — drop unused tomorrow_note shell (today-only DM for Adir).

UPDATE public.staff_message_templates
SET digest_config = digest_config - 'tomorrow_note'
WHERE template_key = 'adir_morning_brief'
  AND digest_config ? 'tomorrow_note';
