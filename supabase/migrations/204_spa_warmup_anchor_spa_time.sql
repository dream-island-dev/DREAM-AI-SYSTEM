-- spa_warmup_daypass must schedule per-guest from spa_time (Spa Board / EZGO),
-- not arrival_confirmed_at. Legacy ACC edits could corrupt anchor_event.

UPDATE public.automation_stages
SET schedule_mode = 'hours_after_event',
    anchor_event = 'spa_time',
    offset_hours = COALESCE(
      CASE WHEN offset_hours < 0 THEN offset_hours ELSE NULL END,
      -0.5
    ),
    day_offset = NULL,
    local_time = NULL,
    local_time_end = NULL,
    updated_at = now()
WHERE stage_key = 'spa_warmup_daypass';
