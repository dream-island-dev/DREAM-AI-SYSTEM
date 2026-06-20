-- Migration 051: Add 'cancelled' status to guests table
-- A cancelled guest should never receive automated WhatsApp messages,
-- similar to needs_callback=true. This allows staff to mark no-shows,
-- refunds, or date-change-pending guests without deleting the record.

ALTER TABLE public.guests
  DROP CONSTRAINT IF EXISTS guests_status_check;

ALTER TABLE public.guests
  ADD CONSTRAINT guests_status_check
    CHECK (status IN ('pending', 'expected', 'room_ready', 'checked_in', 'cancelled'));

COMMENT ON COLUMN public.guests.status IS
  'pending=imported/unconfirmed, expected=arriving, room_ready=room set, checked_in=arrived, cancelled=no-show/refund/deleted';
