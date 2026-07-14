-- 206: Morning Stage 3 send window + Whapi script sync with Meta suite_welcome_morning
-- Root cause (2026-07-14): morning_suite had no local_time_end → cron fired all day
-- after 06:00 for late-imported guests. Whapi path used stage_3_morning bot_script
-- still saying 09:00 while Meta template already says 12:00/15:00.

-- ── Send window ceiling (Israel local) ──────────────────────────────────────
UPDATE public.automation_stages
SET local_time_end = '10:00'
WHERE stage_key = 'morning_suite'
  AND (local_time_end IS NULL OR local_time_end < local_time);

UPDATE public.automation_stages
SET local_time_end = '10:00'
WHERE stage_key = 'morning_welcome'
  AND (local_time_end IS NULL OR local_time_end < local_time);

-- ── Whapi session scripts — mirror approved Meta suite_welcome_morning body ─
-- Weekday: entry 12:00, suite check-in 15:00 (Shabbat variant unchanged in 172/173).

UPDATE public.bot_scripts
SET message_text = E'בוקר אור {{GUEST_NAME}}! ✨ היום זה היום! הריזורט מוכן וכל הצוות שלנו כבר מחכה להעניק לכם חוויה בלתי נשכחת.\n\nכמה פרטים קטנים וחשובים לדרך:\n🌸 כניסה למתחם החל מהשעה 12:00\n🔑 קבלת הסוויטות החל מהשעה 15:00.\n\nאם יש לכם שאלה כלשהי בדרך, אנחנו זמינים כאן בצ''אט. נסיעה טובה ובטוחה! 🚗❤️'
WHERE script_key = 'stage_3_morning';

UPDATE public.bot_scripts
SET message_text = E'בוקר אור {{GUEST_NAME}}! ✨ היום זה היום! הריזורט מוכן וכל הצוות שלנו כבר מחכה להעניק לכם חוויה בלתי נשכחת.\n\nכמה פרטים קטנים וחשובים לדרך:\n🌸 כניסה למתחם החל מהשעה 12:00\n🔑 קבלת הסוויטות החל מהשעה 15:00.\n\nאם יש לכם שאלה כלשהי בדרך, אנחנו זמינים כאן בצ''אט. נסיעה טובה ובטוחה! 🚗❤️\n\nנשמח לאישור קצר — לחצו «מחכים לכם!» או כתבו את זה כאן 🌴'
WHERE script_key = 'morning_daypass';

-- ── Inbox WYSIWYG cache (if row exists) ─────────────────────────────────────
UPDATE public.wa_templates
SET content = E'בוקר אור {{1}}! ✨ היום זה היום! הריזורט מוכן וכל הצוות שלנו כבר מחכה להעניק לכם חוויה בלתי נשכחת.\n\nכמה פרטים קטנים וחשובים לדרך:\n🌸 כניסה למתחם החל מהשעה 12:00\n🔑 קבלת הסוויטות החל מהשעה 15:00.\n\nאם יש לכם שאלה כלשהי בדרך, אנחנו זמינים כאן בצ''אט. נסיעה טובה ובטוחה! 🚗❤️'
WHERE template_name = 'suite_welcome_morning'
  AND content LIKE '%09:00%';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.automation_stages
    WHERE stage_key = 'morning_suite' AND local_time_end = '10:00'::time
  ) THEN
    RAISE EXCEPTION '206_self_test: morning_suite local_time_end not set';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.bot_scripts
    WHERE script_key = 'stage_3_morning'
      AND message_text LIKE '%12:00%'
      AND message_text NOT LIKE '%09:00%'
  ) THEN
    RAISE EXCEPTION '206_self_test: stage_3_morning script not synced to 12:00 entry';
  END IF;
END $$;
