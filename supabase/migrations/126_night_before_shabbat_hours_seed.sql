-- 126 — Stage 2.5 Shabbat hours backfill (session 102)
-- migration 086 seeded Shabbat bot_config keys BLANK; whatsapp-send falls back
-- to 15:00/18:00 in code, but admins editing only weekday keys caused confusion.
-- Idempotent: only fills empty Shabbat values — never overwrites admin edits.

UPDATE public.bot_config
SET config_value = '15:00'
WHERE config_key = 'night_before_entry_time_shabbat'
  AND COALESCE(TRIM(config_value), '') = '';

UPDATE public.bot_config
SET config_value = '18:00'
WHERE config_key = 'night_before_checkin_time_shabbat'
  AND COALESCE(TRIM(config_value), '') = '';
