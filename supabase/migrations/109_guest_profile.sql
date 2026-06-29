-- Migration 109: guests.guest_profile — staff-curated structured context (VIP,
-- occasion, dietary, arrival). Distinct from guest_notes (append-only system audit).

ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS guest_profile JSONB NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.guests.guest_profile IS
  'Staff-editable structured guest context: vip_status, occasion, dietary, arrival_context, staff_note. AI-readable via whatsapp-webhook. Not the guest_notes audit log.';

CREATE INDEX IF NOT EXISTS idx_guests_profile_gin
  ON public.guests USING GIN (guest_profile);
