-- 280: Day-pass Stage 3 (morning_welcome) — fixed Meta fallback, no suite Shabbat pair.
-- Runtime: session morning_daypass when 24h open; dream_checkin_reminder_v2 cold-start only.

UPDATE public.automation_stages
SET meta_template_name = 'dream_checkin_reminder_v2'
WHERE stage_key = 'morning_welcome'
  AND meta_template_name IN ('suite_welcome_morning', 'suite_welcome_morning_shabbat', 'dream_welcome_morning');
