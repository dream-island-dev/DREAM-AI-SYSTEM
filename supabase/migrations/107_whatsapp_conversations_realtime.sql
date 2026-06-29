-- Migration 107: Ensure whatsapp_conversations is in the supabase_realtime publication.
-- Without this, postgres_changes subscriptions on whatsapp_conversations connect
-- successfully but never receive INSERT/UPDATE events (same failure mode as
-- guest_alerts migration 059 and guests migration 082).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'whatsapp_conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_conversations;
  END IF;
END $$;
