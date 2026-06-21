-- Migration 059: Ensure guest_alerts is in the supabase_realtime publication.
-- Without this, RequestsAlertWidget.js's postgres_changes subscription
-- silently never fires (no error, just no events) — Realtime only delivers
-- changes for tables explicitly added to this publication. Guarded so it's
-- a no-op if the table was already added (e.g. via the Dashboard UI).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'guest_alerts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.guest_alerts;
  END IF;
END $$;
