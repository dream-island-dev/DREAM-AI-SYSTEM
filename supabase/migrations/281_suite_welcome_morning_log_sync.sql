-- 281: Sync message_templates.suite_welcome_morning with Meta-approved body (12:00 entry).
-- Inbox WYSIWYG logging only — actual Meta send uses Graph API / approved template.

UPDATE public.message_templates
SET content = E'בוקר אור {{1}}! ✨ היום זה היום!\nהריזורט מוכן וכל הצוות שלנו כבר מחכה להעניק לכם חוויה בלתי נשכחת.\n\nכמה פרטים קטנים וחשובים לדרך:\n🌸 כניסה למתחם החל מהשעה 12:00\n🔑 קבלת הסוויטות החל מהשעה 15:00.\n\nאם יש לכם שאלה כלשהי בדרך, אנחנו זמינים כאן בצ''אט. נסיעה טובה ובטוחה! 🚗❤️'
WHERE wa_template_name = 'suite_welcome_morning';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.message_templates
    WHERE wa_template_name = 'suite_welcome_morning'
      AND content LIKE '%12:00%'
      AND content NOT LIKE '%09:00%'
  ) THEN
    RAISE EXCEPTION '281_self_test: suite_welcome_morning message_templates not synced';
  END IF;
END $$;
