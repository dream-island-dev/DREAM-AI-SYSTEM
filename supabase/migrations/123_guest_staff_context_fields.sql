-- Migration 123: staff color flag + internal notes for front-desk context drawer
-- staff_color_label — quick visual triage (red/yellow/green/blue)
-- internal_notes — editable staff-only notes (separate from append-only guest_notes audit log)

ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS staff_color_label TEXT
    CHECK (staff_color_label IS NULL OR staff_color_label IN ('red', 'yellow', 'green', 'blue')),
  ADD COLUMN IF NOT EXISTS internal_notes TEXT;

COMMENT ON COLUMN public.guests.staff_color_label IS
  'Front-desk color flag: red|yellow|green|blue — set from WhatsAppInbox GuestContextDrawer.';
COMMENT ON COLUMN public.guests.internal_notes IS
  'Editable staff-only context notes (not the append-only guest_notes system log).';

CREATE INDEX IF NOT EXISTS idx_guests_staff_color_label
  ON public.guests (staff_color_label)
  WHERE staff_color_label IS NOT NULL;
