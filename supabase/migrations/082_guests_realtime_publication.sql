-- Migration 082: Ensure `guests` is in the supabase_realtime publication.
-- Same documented failure mode as migration 059 (guest_alerts): without this,
-- WhatsAppInbox.js's new "wa-inbox-guests-rt" postgres_changes subscription
-- (session 9, Sprint 9.3 — cross-tab claim/assignment sync) would subscribe
-- successfully and never error, but silently never receive an event. Guarded
-- so it's a no-op if the table was already added (e.g. via the Dashboard UI).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'guests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.guests;
  END IF;
END $$;
