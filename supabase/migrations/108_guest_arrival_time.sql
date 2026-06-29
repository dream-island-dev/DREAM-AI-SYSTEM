-- Migration 108: guests.arrival_time — guest-stated estimated arrival (HH:MM)
-- Written by whatsapp-webhook record-only path; distinct from checkin_time (actual check-in timestamp).

ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS arrival_time TEXT;

COMMENT ON COLUMN public.guests.arrival_time IS
  'Guest-estimated arrival time (HH:MM), set by whatsapp-webhook record-only handler. Not the operational checkin_time timestamp.';
