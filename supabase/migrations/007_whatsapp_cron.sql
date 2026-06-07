-- ================================================================
-- Migration 007: Schedule the WhatsApp trigger scanner via pg_cron
-- Runs whatsapp-cron every 15 minutes. The function is deployed
-- --no-verify-jwt, so no auth header / key is needed here.
-- Safe to re-run (unschedule guarded).
-- ================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove any previous version of the job (no error if absent).
DO $$
BEGIN
  PERFORM cron.unschedule('whatsapp-triggers');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'whatsapp-triggers',
  '*/15 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://bunohsdggxyyzruubvcd.supabase.co/functions/v1/whatsapp-cron',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);

-- ================================================================
-- END OF MIGRATION 007
-- ================================================================
