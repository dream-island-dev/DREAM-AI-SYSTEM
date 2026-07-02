-- 119_guest_room_ready_notified.sql
-- Session 84 — Idempotency guardrail for "חדר מוכן" WhatsApp (one notify per active stay).
-- Canonical flag for whatsapp-send room_ready fast-path; msg_room_ready_sent kept in sync for legacy UI.

ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS room_ready_notified BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.guests.room_ready_notified IS
  'True once room-ready WhatsApp was successfully sent for this stay (whatsapp-send trigger room_ready). '
  'Reset to false on checked_out so the next stay on the same row starts fresh.';

-- Backfill from existing pipeline flag (migration 030).
UPDATE public.guests
SET room_ready_notified = TRUE
WHERE msg_room_ready_sent = TRUE
  AND room_ready_notified = FALSE;
