-- Fix RLS gap found in QA/security sweep 2026-08-05: housekeeping_wa_events only had a
-- SELECT policy for authenticated (migration 150). The browser-side reconcile write added
-- in migration 286 (src/utils/housekeepingCheckInReconcile.js markHousekeepingEventSynced,
-- called from GuestsPage.js) updates sync_action/sync_error/guest_id from the client and
-- was silently no-op'ing under RLS — the guest check-in itself still succeeded (writes to
-- guests/room_status), but the new sync-audit trail this table exists for never persisted.
--
-- Grant staff UPDATE scoped to only the audit columns (sync_action/sync_error/guest_id) —
-- the raw signal fields (wa_message_id/room_number/event_type/source_line) stay
-- append-only from the client, matching how service-role writers (whapi-webhook) create them.

CREATE POLICY housekeeping_wa_events_update_staff_sync
  ON public.housekeeping_wa_events FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

GRANT UPDATE (sync_action, sync_error, guest_id) ON public.housekeeping_wa_events TO authenticated;
