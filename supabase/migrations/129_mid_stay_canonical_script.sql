-- 129_mid_stay_canonical_script.sql
-- Stage 4 (mid_stay): align bot_scripts + message_templates with canonical copy
-- (no "בוקר טוב" — wrong when cron fires after morning). Cap send window 10:00–12:00.

UPDATE public.bot_scripts
SET message_text = E'היי {{GUEST_NAME}}, הזמן עף כשנהנים... 🤍\n\nרק רצינו לעצור לרגע ולוודא שאתם נרגעים, נהנים ומנצלים את כל הטוב שיש לדרים איילנד להציע.\n\nאם חסר לכם משהו בסוויטה, או אם יש כל דבר שנוכל לעשות כדי להפוך את השהות שלכם לעוד יותר מושלמת — פשוט תכתבו לנו כאן. תמשיכו ליהנות! ✨'
WHERE script_key = 'mid_stay';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'message_templates'
      AND column_name = 'wa_template_name'
  ) THEN
    UPDATE public.message_templates
    SET content = E'היי {{1}}, הזמן עף כשנהנים... 🤍\nרק רצינו לעצור לרגע ולוודא שאתם נרגעים, נהנים ומנצלים את כל הטוב שיש לדרים איילנד להציע.\n\nאם חסר לכם משהו בסוויטה, או אם יש כל דבר שנוכל לעשות כדי להפוך את השהות שלכם לעוד יותר מושלמת — פשוט תכתבו לנו כאן תגובה חופשית, או לחצו על הכפתור למטה ונציג יצור איתכם קשר מיד. תמשיכו ליהנות! ✨'
    WHERE wa_template_name = 'dream_mid_stay_check';
  ELSE
    UPDATE public.message_templates
    SET content = E'היי {{1}}, הזמן עף כשנהנים... 🤍\nרק רצינו לעצור לרגע ולוודא שאתם נרגעים, נהנים ומנצלים את כל הטוב שיש לדרים איילנד להציע.\n\nאם חסר לכם משהו בסוויטה, או אם יש כל דבר שנוכל לעשות כדי להפוך את השהות שלכם לעוד יותר מושלמת — פשוט תכתבו לנו כאן תגובה חופשית, או לחצו על הכפתור למטה ונציג יצור איתכם קשר מיד. תמשיכו ליהנות! ✨'
    WHERE label LIKE '%מצב שהות%';
  END IF;
END $$;

UPDATE public.automation_stages
SET local_time_end = '12:00'
WHERE stage_key = 'mid_stay';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.bot_scripts
    WHERE script_key = 'mid_stay'
      AND message_text NOT LIKE '%בוקר טוב%'
      AND message_text LIKE '%הזמן עף%'
  ) THEN
    RAISE EXCEPTION '129_self_test: mid_stay bot_scripts text not updated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.automation_stages
    WHERE stage_key = 'mid_stay' AND local_time_end = '12:00'
  ) THEN
    RAISE EXCEPTION '129_self_test: mid_stay local_time_end not set';
  END IF;
END $$;
