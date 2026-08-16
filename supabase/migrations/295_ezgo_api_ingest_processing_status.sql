-- 295_ezgo_api_ingest_processing_status.sql
-- EZGO live API sync — Phase 2 prerequisite. Adds 'processing' as a valid
-- ezgo_api_ingest.status so a future scheduled sync worker (ezgo-guest-sync,
-- not yet deployed — see supabase/functions/ezgo-guest-sync/index.ts) can
-- race-safely claim a batch of staged rows (UPDATE ... SET status='processing'
-- WHERE status='staged' ... RETURNING) before processing them, the same
-- claim-then-finalize shape already used elsewhere in this codebase
-- (whapi-webhook's insert-then-23505 pattern is a different shape for a
-- different problem — this one is a long-running batch claim, not a single
-- insert). Rows that can't be resolved yet (e.g. RoomId not yet mapped) are
-- released back to 'staged' for a later retry, not stuck in 'processing'.

ALTER TABLE public.ezgo_api_ingest
  DROP CONSTRAINT IF EXISTS ezgo_api_ingest_status_check;

ALTER TABLE public.ezgo_api_ingest
  ADD CONSTRAINT ezgo_api_ingest_status_check
  CHECK (status IN ('staged', 'processing', 'parsed', 'failed', 'ignored'));

COMMENT ON COLUMN public.ezgo_api_ingest.status IS
  'staged = new, unclaimed. processing = claimed by a sync worker mid-run (should be brief; a row stuck here past one run is a bug). parsed = successfully applied to guests/suite_rooms. failed = unexpected error, needs investigation (see notes). ignored = permanently out of current-phase scope (Activities/MealTimings/Delete-type/multi-room orders — see notes for which).';
