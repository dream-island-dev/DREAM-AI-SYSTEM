-- Migration 045: Golden Guest Profile — new columns for comprehensive daily report
-- and missing cron flag guards (whatsapp-send already references these columns;
-- adding the ones that were never created so the cron SELECT can use them safely).

-- ── Part A: Golden Guest Profile fields ──────────────────────────────────────
-- Populated by DataUpload Tab 2 (comprehensive daily report / "ספר הזמנות").
-- order_number: the PMS booking ID extracted from column B ("266932: NAME - PHONE")
-- treatment_count: total spa treatment slots booked across all time slots
ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS order_number TEXT,
  ADD COLUMN IF NOT EXISTS treatment_count INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.guests.order_number IS
  'PMS booking ID from the daily report (column B prefix). e.g. "266932"';
COMMENT ON COLUMN public.guests.treatment_count IS
  'Total spa treatment slots booked. 0 = no spa booking in current report.';

-- ── Part B: Cron flag guards — currently missing from DB ─────────────────────
-- whatsapp-send/index.ts already declares these in GUEST_FLAG and tries to SET
-- them after each successful pipeline send. The cron, however, never SELECTs
-- them so it has no guard against re-firing the same trigger every 15 minutes.
-- These four columns close that gap.
ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS msg_pre_arrival_sent      BOOL NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS msg_morning_suite_sent     BOOL NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS msg_morning_welcome_sent   BOOL NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS msg_post_checkin_sent      BOOL NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.guests.msg_pre_arrival_sent IS
  'TRUE after night_before (T-1) WhatsApp template was successfully sent.';
COMMENT ON COLUMN public.guests.msg_morning_suite_sent IS
  'TRUE after morning_suite (day-of VIP) WhatsApp template was sent.';
COMMENT ON COLUMN public.guests.msg_morning_welcome_sent IS
  'TRUE after morning_welcome (day-of standard) WhatsApp template was sent.';
COMMENT ON COLUMN public.guests.msg_post_checkin_sent IS
  'TRUE after butler_1h WhatsApp follow-up was sent post check-in.';
