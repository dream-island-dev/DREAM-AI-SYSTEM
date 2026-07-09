-- =============================================================================
-- 172_shabbat_whapi_automation.sql
-- Shabbat arrival automation via Whapi (Suites device):
--   • Separate bot_scripts + images for Stage 2.5 (night_before) and Stage 3
--     (morning_suite) when arrival_date is Saturday / special holiday list.
--   • night_before fires Friday 15:00 Israel (day_offset -1) for Saturday arrivals.
-- =============================================================================

ALTER TABLE public.automation_stages
  ADD COLUMN IF NOT EXISTS session_message_script_key_shabbat TEXT,
  ADD COLUMN IF NOT EXISTS session_message_image_url_shabbat TEXT,
  ADD COLUMN IF NOT EXISTS local_time_shabbat TIME;

COMMENT ON COLUMN public.automation_stages.local_time_shabbat IS
  'Optional Israel-local send floor for Shabbat/holiday arrivals — overrides local_time when guest arrival_date is Saturday (or night_before_special_dates).';

COMMENT ON COLUMN public.automation_stages.session_message_script_key_shabbat IS
  'bot_scripts.script_key used when guest arrival_date is Shabbat/Saturday (or night_before_special_dates). Falls back to session_message_script_key when NULL.';

COMMENT ON COLUMN public.automation_stages.session_message_image_url_shabbat IS
  'Optional image URL for Shabbat-variant session sends (Whapi image+caption or Meta session image).';

-- ── Stage 2.5 Shabbat script (Friday 15:00 → Saturday arrivals) ─────────────
INSERT INTO public.bot_scripts (script_key, display_name, trigger_event, message_text, is_active)
VALUES (
  'night_before_reminder_shabbat',
  'תזכורת ערב לפני — הגעה בשבת (שלב 2.5)',
  'night_before',
  E'יי🌸\nמעדכנים שמשרד הסוויטות נסגר והכניסה תהיה דרך הקבלה הראשית .\nמצפים לראותכם!\nצוות Dream island 🏝️',
  true
)
ON CONFLICT (script_key) DO UPDATE
  SET message_text = EXCLUDED.message_text,
      display_name = EXCLUDED.display_name,
      trigger_event = EXCLUDED.trigger_event;

-- ── Stage 3 Shabbat morning script (18:00 check-in baked in) ─────────────────
INSERT INTO public.bot_scripts (script_key, display_name, trigger_event, message_text, is_active)
VALUES (
  'stage_3_morning_shabbat',
  'בוקר הגעה — שבת (שלב 3)',
  'morning_of',
  E'בוקר אור {{GUEST_NAME}}! ✨ היום זה היום!\nהריזורט מוכן, השמש בחוץ, וכל הצוות שלנו כבר מחכה להעניק לכם חוויה בלתי נשכחת.\n\nכמה פרטים קטנים וחשובים לדרך:\n🌸 כניסה למתחם החל מהשעה 12:00.\n🔑 קבלת החדרים והסוויטות היא החל מהשעה 18:00.\n\nאם יש לכם שאלה כלשהי בדרך, אנחנו זמינים כאן בצ''אט. נסיעה טובה ובטוחה! 🚗❤️',
  true
)
ON CONFLICT (script_key) DO UPDATE
  SET message_text = EXCLUDED.message_text,
      display_name = EXCLUDED.display_name,
      trigger_event = EXCLUDED.trigger_event;

-- ── Wire night_before (Stage 2.5) ───────────────────────────────────────────
UPDATE public.automation_stages
SET
  local_time_shabbat = '15:00',
  session_message_script_key_shabbat = 'night_before_reminder_shabbat',
  session_message_image_url_shabbat = 'https://dream-ai-system.vercel.app/images/suiteshabat.jpeg'
WHERE stage_key = 'night_before';

-- ── Wire morning_suite (Stage 3) ────────────────────────────────────────────
UPDATE public.automation_stages
SET
  session_message_script_key_shabbat = 'stage_3_morning_shabbat'
WHERE stage_key = 'morning_suite';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.bot_scripts
    WHERE script_key = 'night_before_reminder_shabbat'
      AND message_text LIKE '%משרד הסוויטות%'
  ) THEN
    RAISE EXCEPTION '172_self_test: night_before_reminder_shabbat missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.automation_stages
    WHERE stage_key = 'night_before'
      AND session_message_script_key_shabbat = 'night_before_reminder_shabbat'
      AND local_time_shabbat = '15:00'::time
  ) THEN
    RAISE EXCEPTION '172_self_test: night_before shabbat wiring failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.automation_stages
    WHERE stage_key = 'morning_suite'
      AND session_message_script_key_shabbat = 'stage_3_morning_shabbat'
  ) THEN
    RAISE EXCEPTION '172_self_test: morning_suite shabbat wiring failed';
  END IF;
END $$;
