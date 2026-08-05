-- Housekeeping WA check-in outcome — visible sync status for GuestsPage reconcile + audit.

ALTER TABLE public.housekeeping_wa_events
  ADD COLUMN IF NOT EXISTS sync_action TEXT,
  ADD COLUMN IF NOT EXISTS sync_error TEXT,
  ADD COLUMN IF NOT EXISTS guest_id BIGINT REFERENCES public.guests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_housekeeping_wa_events_room_type_created
  ON public.housekeeping_wa_events (room_id, event_type, created_at DESC);

COMMENT ON COLUMN public.housekeeping_wa_events.sync_action IS
  'applyHousekeepingCheckInSignal outcome: updated, already_checked_in, no_guest, ambiguous_guest, guest_not_eligible, error, dedup.';
COMMENT ON COLUMN public.housekeeping_wa_events.sync_error IS
  'Optional error detail when sync_action is error or checkout_failed.';
COMMENT ON COLUMN public.housekeeping_wa_events.guest_id IS
  'Guest targeted by the signal (set on success or when guest was identified but update failed).';
