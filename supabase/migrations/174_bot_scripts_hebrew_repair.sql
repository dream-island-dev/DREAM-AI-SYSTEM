-- =============================================================================
-- 174_bot_scripts_hebrew_repair.sql
-- Root cause: migration 173's "fix" was applied ad hoc via a PowerShell pipe
-- (Get-Content -Encoding UTF8 file.sql | npx supabase db query --linked)
-- instead of `npx supabase db push`. PowerShell 5.1 re-encodes piped text
-- handed to a native process's stdin using [Console]::OutputEncoding (the
-- OEM/console codepage), not UTF-8 — Hebrew has no representation there, so
-- every Hebrew character was silently replaced with a literal '?' before the
-- SQL ever reached Postgres. Production audit confirms only these two rows
-- are affected (name_chars == name_bytes, pure ASCII '?'); every other
-- Hebrew row seeded via `db push` is intact. This migration re-seeds the
-- same two rows and MUST be applied with `npx supabase db push` (never a
-- shell pipe) to avoid repeating the bug.
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
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT script_key, display_name, message_text
    FROM public.bot_scripts
    WHERE script_key IN ('night_before_reminder_shabbat', 'stage_3_morning_shabbat')
  LOOP
    IF r.display_name !~ '[א-ת]' OR r.display_name ~ '^[\?\s]+$' THEN
      RAISE EXCEPTION '174_self_test: % display_name still garbled: %', r.script_key, r.display_name;
    END IF;
    IF r.message_text !~ '[א-ת]' OR r.message_text ~ '^[\?\s]+$' THEN
      RAISE EXCEPTION '174_self_test: % message_text still garbled', r.script_key;
    END IF;
  END LOOP;
END $$;
