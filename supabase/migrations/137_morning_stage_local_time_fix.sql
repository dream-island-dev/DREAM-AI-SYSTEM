-- 137_morning_stage_local_time_fix.sql
-- morning_suite was sometimes edited to 15:00 (check-in hour) in ACC — that
-- delays "בוקר הגעה" until afternoon. Reset mistaken afternoon times only.

UPDATE public.automation_stages
SET local_time = '06:00'::time
WHERE stage_key = 'morning_suite'
  AND local_time >= '12:00'::time;

UPDATE public.automation_stages
SET local_time = '08:00'::time
WHERE stage_key = 'morning_welcome'
  AND local_time >= '12:00'::time;

COMMENT ON COLUMN public.automation_stages.local_time IS
  'Israel-local floor hour for day_offset_with_time stages. morning_suite=06:00, morning_welcome=08:00 — NOT check-in time (15:00).';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.automation_stages
    WHERE stage_key = 'morning_suite' AND local_time >= '12:00'::time
  ) THEN
    RAISE EXCEPTION '137_self_test: morning_suite still has afternoon local_time';
  END IF;
END $$;
