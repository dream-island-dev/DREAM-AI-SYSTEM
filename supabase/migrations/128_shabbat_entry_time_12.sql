-- 128 — Shabbat entry time correction (session 108)
-- Business rule: resort entry (כניסה למתחם) is ALWAYS 12:00 — weekday and Shabbat.
-- Room/suite check-in: 15:00 weekday, 18:00 Shabbat only.
-- migration 126 incorrectly seeded night_before_entry_time_shabbat = 15:00.

UPDATE public.bot_config
SET config_value = '12:00'
WHERE config_key = 'night_before_entry_time_shabbat'
  AND COALESCE(TRIM(config_value), '') IN ('', '15:00');

UPDATE public.bot_config
SET config_value = '18:00'
WHERE config_key = 'night_before_checkin_time_shabbat'
  AND COALESCE(TRIM(config_value), '') = '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.bot_config
    WHERE config_key = 'night_before_entry_time_shabbat'
      AND TRIM(config_value) = '12:00'
  ) THEN
    RAISE EXCEPTION 'migration 128 self-test failed: night_before_entry_time_shabbat != 12:00';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.bot_config
    WHERE config_key = 'night_before_checkin_time_shabbat'
      AND TRIM(config_value) = '18:00'
  ) THEN
    RAISE EXCEPTION 'migration 128 self-test failed: night_before_checkin_time_shabbat != 18:00';
  END IF;
END $$;
