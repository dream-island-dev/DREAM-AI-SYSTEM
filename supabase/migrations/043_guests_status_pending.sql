-- Migration 043: Widen guests.status to include 'pending' for freshly-imported EZGO arrivals.
-- Before this migration the constraint only allowed ('expected', 'room_ready', 'checked_in').
-- EZGO arrivals are imported before the guest confirms, so 'pending' is the correct
-- pre-confirmation state.  The WhatsApp cron only picks up guests with status = 'expected'
-- (T-2 days flow) or 'room_ready' / 'checked_in' — 'pending' rows are safe to ignore
-- until a manager promotes them.

ALTER TABLE public.guests
  DROP CONSTRAINT IF EXISTS guests_status_check;

ALTER TABLE public.guests
  ADD CONSTRAINT guests_status_check
    CHECK (status IN ('pending', 'expected', 'room_ready', 'checked_in'));

-- Ensure guest_index column exists with a sane default (added by migration 042).
-- This ADD COLUMN IF NOT EXISTS is a no-op when 042 has already run.
ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS guest_index SMALLINT NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.guests.status IS
  'pending=imported/unconfirmed, expected=arriving today, room_ready=room set, checked_in=arrived';
