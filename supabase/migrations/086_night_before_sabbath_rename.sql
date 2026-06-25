-- =============================================================================
-- 086_night_before_sabbath_rename.sql
-- "STAGE 2.5 UPDATE, SABBATH LOGIC" session.
--
-- night_before is currently paused (is_active=false, set in session 42) while
-- its Meta template sits PENDING — the safe window to redefine its content
-- without any risk of a guest receiving the old/new text mid-flight.
--
-- 1. Visual rename only — display_name changes, stage_key ('night_before')
--    and every guest_flag_column/cron/whatsapp-send reference are untouched.
-- 2. New session-message script (bot_scripts) carrying Mike's exact text with
--    {{entry_time}}/{{check_in_time}} placeholders, wired via
--    automation_stages.session_message_script_key (was NULL).
-- 3. New automation_stages.session_message_image_url column — generic (any
--    future hybrid stage can use it), set here to the documented production
--    asset path. The file itself (image_3cde8f.jpg) is not yet in the repo —
--    this is intentionally forward-wired so it activates the moment the file
--    is pushed to public/images/, no further migration needed.
-- 4. Sabbath/Holiday knowledge — reuses the existing bot_config "knowledge"
--    category (admin-editable today via BotConfigPanel.js, zero new UI) for
--    the weekday/Shabbat time pairs + a holiday-date list. Shabbat values are
--    seeded BLANK on purpose — Mike's directive said "e.g. 18:00", not a
--    confirmed value, and whatsapp-send's resolver (next change) treats a
--    blank Shabbat config as a hard failure (visible in Automation History),
--    never a silent wrong-time guess to a real guest.
-- =============================================================================

-- ── 1. Rename + wire session message + image column ─────────────────────────
ALTER TABLE public.automation_stages
  ADD COLUMN IF NOT EXISTS session_message_image_url TEXT;

COMMENT ON COLUMN public.automation_stages.session_message_image_url IS
  'Optional media to send alongside session_message_script_key''s text (Meta type:"image" message, caption=resolved text). NULL = text-only session message, unchanged behavior.';

UPDATE public.automation_stages
SET
  display_name = 'Stage 2.5 — תזכורת ערב לפני 📅',
  session_message_script_key = 'night_before_reminder',
  session_message_image_url = 'https://dream-ai-system.vercel.app/images/image_3cde8f.jpg'
WHERE stage_key = 'night_before';

-- ── 2. bot_scripts — exact content, verbatim from the directive ─────────────
INSERT INTO public.bot_scripts (script_key, display_name, trigger_event, message_text, is_active)
VALUES (
  'night_before_reminder',
  'תזכורת ערב לפני (Stage 2.5) — כניסה דרך Dream Suites',
  'night_before',
  'היי מה שלומכם?🌸
מצפים להגעה שלכם לדרים איילנד.
מעדכנים שהכניסה למתחם תיהיה דרך הכניסה של dream suites🙏
תגיעו לשער ותצלצלו בפעמון יפתחו לכם.
ממליצים להגיע מוכנים עם בגדי ים וכפכפים.
כניסה למתחם החל מהשעה - {{entry_time}}
וקבלת החדרים החל משעה - {{check_in_time}}
מחכים לכם
צוות דרים איילנד🌸',
  true
)
ON CONFLICT (script_key) DO UPDATE
  SET message_text = EXCLUDED.message_text,
      display_name = EXCLUDED.display_name,
      trigger_event = EXCLUDED.trigger_event;
      -- is_active intentionally NOT overwritten — same convention as every
      -- other seeded bot_scripts/automation_stages row in this repo.

-- ── 3. Sabbath/Holiday knowledge base (bot_config, category='knowledge') ────
INSERT INTO public.bot_config (config_key, config_value, category, label) VALUES
  ('night_before_entry_time_weekday',
   '12:00',
   'knowledge', 'תזכורת ערב לפני — כניסה למתחם (יום חול)'),

  ('night_before_checkin_time_weekday',
   '15:00',
   'knowledge', 'תזכורת ערב לפני — קבלת חדרים (יום חול)'),

  ('night_before_entry_time_shabbat',
   '',
   'knowledge', 'תזכורת ערב לפני — כניסה למתחם (שבת/חג) ⚠️ חובה למלא לפני הפעלה'),

  ('night_before_checkin_time_shabbat',
   '',
   'knowledge', 'תזכורת ערב לפני — קבלת חדרים (שבת/חג) ⚠️ חובה למלא לפני הפעלה'),

  ('night_before_special_dates',
   '',
   'knowledge', 'תאריכי חג נוספים (לא שבת) שמקבלים שעות שבת — רשימה מופרדת בפסיקים, פורמט YYYY-MM-DD')
ON CONFLICT (config_key) DO NOTHING;
