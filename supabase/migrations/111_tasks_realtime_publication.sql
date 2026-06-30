-- Migration 111: Ensure `tasks` is in the supabase_realtime publication.
-- OperationsBoard.js subscribes to postgres_changes on tasks so 👍🏼 reactions
-- in the Whapi group (whapi-webhook → status='done') clear the board live.
-- Same guarded no-op pattern as migrations 059/082/107.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'tasks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
  END IF;
END $$;
