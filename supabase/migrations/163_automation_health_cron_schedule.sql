-- ================================================================
-- Migration 163: Schedule automation-health-cron via pg_cron
-- Runs every 10 minutes. The function is deployed --no-verify-jwt,
-- so no auth header / key is needed here (same pattern as migration 007's
-- "whatsapp-triggers" job for whatsapp-cron).
-- Safe to re-run (unschedule guarded).
--
-- NOTE: deploying this migration does nothing dangerous by itself — the
-- function's own AUTOMATION_HEALTH_ENABLED kill-switch (default off) still
-- gates whether it actually writes state or sends Whapi alerts. This just
-- makes sure it's TICKING once that switch is turned on.
-- ================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  PERFORM cron.unschedule('automation-health-cron');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'automation-health-cron',
  '*/10 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://bunohsdggxyyzruubvcd.supabase.co/functions/v1/automation-health-cron',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);

-- ================================================================
-- END OF MIGRATION 163
-- ================================================================
