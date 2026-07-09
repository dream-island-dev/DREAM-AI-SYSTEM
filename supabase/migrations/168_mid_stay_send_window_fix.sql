-- 168_mid_stay_send_window_fix.sql
-- Stage 4 (mid_stay) had local_time_end=12:00 from migration 129 while admins
-- changed local_time to 17:00 in ACC — hidden ceiling → never-send + quiet_hours_passed.
-- Clear invalid ceilings (end < start); resolver also ignores them defensively.

UPDATE public.automation_stages
SET local_time_end = NULL
WHERE schedule_mode = 'day_offset_with_time'
  AND local_time IS NOT NULL
  AND local_time_end IS NOT NULL
  AND local_time_end < local_time;
