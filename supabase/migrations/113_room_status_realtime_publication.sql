-- Migration 113: Ensure `room_status` is in the supabase_realtime publication.
-- Without this, postgres_changes subscriptions on room_status (AICopilot.js,
-- HousekeepingTabletView.js, RoomBoard.js) connect successfully but never
-- receive events — same failure mode as migrations 059/082/111.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'room_status'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.room_status;
  END IF;
END $$;
