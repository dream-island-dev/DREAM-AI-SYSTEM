-- =============================================================================
-- 173_fix_shabbat_bot_script_encoding.sql
-- Repair display_name (and re-assert message_text) for Shabbat bot_scripts rows
-- that were corrupted when migration 172 was applied via PowerShell pipe without
-- UTF-8 encoding. Self-test verifies Hebrew is present in display_name.
-- =============================================================================

UPDATE public.bot_scripts
SET
  display_name = 'תזכורת ערב לפני — הגעה בשבת (שלב 2.5)',
  message_text = E'יי🌸\nמעדכנים שמשרד הסוויטות נסגר והכניסה תהיה דרך הקבלה הראשית .\nמצפים לראותכם!\nצוות Dream island 🏝️'
WHERE script_key = 'night_before_reminder_shabbat';

UPDATE public.bot_scripts
SET
  display_name = 'בוקר הגעה — שבת (שלב 3)',
  message_text = E'בוקר אור {{GUEST_NAME}}! ✨ היום זה היום!\nהריזורט מוכן, השמש בחוץ, וכל הצוות שלנו כבר מחכה להעניק לכם חוויה בלתי נשכחת.\n\nכמה פרטים קטנים וחשובים לדרך:\n🌸 כניסה למתחם החל מהשעה 12:00.\n🔑 קבלת החדרים והסוויטות היא החל מהשעה 18:00.\n\nאם יש לכם שאלה כלשהי בדרך, אנחנו זמינים כאן בצ''אט. נסיעה טובה ובטוחה! 🚗❤️'
WHERE script_key = 'stage_3_morning_shabbat';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.bot_scripts
    WHERE script_key = 'night_before_reminder_shabbat'
      AND display_name LIKE '%שבת%'
      AND message_text LIKE '%משרד הסוויטות%'
  ) THEN
    RAISE EXCEPTION '173_self_test: night_before_reminder_shabbat encoding repair failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.bot_scripts
    WHERE script_key = 'stage_3_morning_shabbat'
      AND display_name LIKE '%שבת%'
      AND message_text LIKE '%18:00%'
  ) THEN
    RAISE EXCEPTION '173_self_test: stage_3_morning_shabbat encoding repair failed';
  END IF;
END $$;
