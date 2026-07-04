-- 131_stage_2_immediate_on_confirm.sql
-- Stage 2 must fire at offset 0 from arrival_confirmed_at in cron/queue.
-- Live «כן מגיעים» is always immediate in whatsapp-webhook (session 114).

UPDATE public.automation_stages
SET offset_hours = 0
WHERE stage_key = 'stage_2_arrival'
  AND COALESCE(offset_hours, 0) <> 0;

COMMENT ON COLUMN public.automation_stages.offset_hours IS
  'hours_after_event delay from anchor_event. stage_2_arrival: webhook sends immediately on guest confirm; this offset applies to cron/ACC catch-up only.';
