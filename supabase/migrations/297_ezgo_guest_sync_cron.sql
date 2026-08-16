-- 297_ezgo_guest_sync_cron.sql
-- EZGO live API sync — Phase 2 go-live. Schedules the ezgo-guest-sync batch
-- worker (supabase/functions/ezgo-guest-sync/index.ts) via a dedicated
-- pg_cron job, deliberately NOT folded into whatsapp-cron's 15-minute
-- guest-automation tick — mirrors whapi-queue-drain (migration 274) exactly:
-- an isolated 1-minute drain of its own queue/staging table, independent of
-- that cadence and that pipeline's logic.
--
-- No Authorization header, same as every other pg_cron -> net.http_post job
-- in this codebase (automation-health-cron/whapi-queue-drain/sla-escalation-
-- cron/etc.) — pg_cron's raw SQL has no way to hold a secret, so these all
-- rely on the function being deployed --no-verify-jwt. ezgo-guest-sync's own
-- isAuthorizedCaller() was updated to accept a request with no Authorization
-- header for exactly this reason (see that file's doc comment) — it trusts
-- nothing from the request itself, only rows already staged in
-- ezgo_api_ingest by the separately-authenticated ezgo-webhook.
--
-- Each run claims up to BATCH_LIMIT=500 staged rows (hardcoded in the
-- function, not a migration concern) — at 1 run/minute this drains today's
-- ~15k backlog over roughly half an hour, then keeps pace with live traffic.
-- Safe to re-run (idempotent).

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  PERFORM cron.unschedule('ezgo-guest-sync');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'ezgo-guest-sync',
  '* * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://bunohsdggxyyzruubvcd.supabase.co/functions/v1/ezgo-guest-sync',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);

-- ================================================================
-- END OF MIGRATION 297
-- ================================================================
