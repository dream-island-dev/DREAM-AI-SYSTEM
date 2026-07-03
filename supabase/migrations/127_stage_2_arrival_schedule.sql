-- 127_stage_2_arrival_schedule.sql
-- Stage 2 (arrival confirmation reply) joins the schedulable pipeline:
-- fires N hours after arrival_confirmed_at (default 0 = immediate via cron/webhook),
-- visible in automation-queue Live Monitor, bulk-dispatchable from ACC.

ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS arrival_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS msg_stage_2_arrival_sent BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.guests.arrival_confirmed_at IS
  'Set when guest confirms arrival (כן מגיעים / button). Anchor for stage_2_arrival schedule.';
COMMENT ON COLUMN public.guests.msg_stage_2_arrival_sent IS
  'Idempotency flag for stage_2_arrival (whatsapp-webhook + whatsapp-send + cron).';

UPDATE public.automation_stages
SET
  schedule_mode       = 'hours_after_event',
  anchor_event        = 'arrival_confirmed_at',
  offset_hours        = COALESCE(offset_hours, 0),
  guest_flag_column   = 'msg_stage_2_arrival_sent'
WHERE stage_key = 'stage_2_arrival';
