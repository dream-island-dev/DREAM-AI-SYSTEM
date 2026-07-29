-- 279: Day-pass survey invite → spa_time + 1h (not fixed 17:00 on arrival day).
-- morning_welcome re-enabled for daypass umbrella (migration 266 applies_to).

UPDATE public.automation_stages
SET
  display_name     = 'סקר חוויית אורח (שעה אחרי ספא) 📊',
  schedule_mode    = 'hours_after_event',
  anchor_event     = 'spa_time',
  offset_hours     = 1,
  day_offset       = NULL,
  local_time       = NULL,
  local_time_end   = NULL,
  is_active        = true
WHERE stage_key = 'survey_invite_daypass';

UPDATE public.automation_stages
SET is_active = true
WHERE stage_key = 'morning_welcome'
  AND applies_to IN ('daypass', 'non_suite');
