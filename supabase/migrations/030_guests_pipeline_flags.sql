-- Migration 030: Add missing WhatsApp pipeline flag columns to guests table.
--
-- These 4 columns were added to the live DB manually (before being captured in
-- a migration file). This migration makes the state reproducible and idempotent.
--
-- Pipeline ownership (whatsapp-send/index.ts is the sole writer):
--   night_before     → msg_pre_arrival_sent     (T-1 check-in reminder)
--   morning_suite    → msg_morning_suite_sent    (suite morning-of welcome)
--   room_ready       → msg_room_ready_sent       (manual UI: room ready)
--   butler_1h        → msg_post_checkin_sent     (1h post check-in, suites)

ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS msg_pre_arrival_sent     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS msg_morning_suite_sent   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS msg_room_ready_sent      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS msg_post_checkin_sent    BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.guests.msg_pre_arrival_sent
  IS 'True once dream_checkin_reminder_v2 was sent (T-1 night before arrival)';
COMMENT ON COLUMN public.guests.msg_morning_suite_sent
  IS 'True once dream_welcome_morning was sent to suite guests (morning of arrival)';
COMMENT ON COLUMN public.guests.msg_room_ready_sent
  IS 'True once room-ready notification was sent from GuestDashboard UI';
COMMENT ON COLUMN public.guests.msg_post_checkin_sent
  IS 'True once dream_handover_agent_v2 butler touch was sent (1h post check-in)';
