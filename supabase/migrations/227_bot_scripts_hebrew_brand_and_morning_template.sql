-- 227: Guest-facing Hebrew brand + align stage_3_morning Meta template label in editor.
-- Replaces "Dream Island" with "דרים איילנד" in bot_scripts bodies sent to guests.
-- Fixes stale meta_template_name dream_morning_v2 → suite_welcome_morning (live send path).

UPDATE public.bot_scripts
SET message_text = REPLACE(message_text, 'Dream Island', 'דרים איילנד')
WHERE message_text LIKE '%Dream Island%';

UPDATE public.bot_scripts
SET meta_template_name = 'suite_welcome_morning'
WHERE script_key = 'stage_3_morning'
  AND COALESCE(meta_template_name, '') IN ('', 'dream_morning_v2', 'dream_welcome_morning');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.bot_scripts
    WHERE script_key = 'greeting_reply'
      AND message_text LIKE '%Dream Island%'
  ) THEN
    RAISE EXCEPTION '227_self_test: greeting_reply still contains Dream Island';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.bot_scripts
    WHERE script_key = 'stage_3_morning'
      AND meta_template_name = 'suite_welcome_morning'
  ) THEN
    RAISE EXCEPTION '227_self_test: stage_3_morning meta_template_name not suite_welcome_morning';
  END IF;
END $$;
