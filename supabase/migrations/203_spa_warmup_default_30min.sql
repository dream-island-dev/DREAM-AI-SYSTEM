-- spa_warmup_daypass: default send 30 minutes before spa_time (was 0 / historically -75m).
-- ACC edits "X minutes before" and persists as offset_hours = -X/60.
-- Day-pass cohort channel remains independently controlled via bot_config.guest_daypass_channel.

UPDATE public.automation_stages
SET offset_hours = -0.5,
    updated_at = now()
WHERE stage_key = 'spa_warmup_daypass';
