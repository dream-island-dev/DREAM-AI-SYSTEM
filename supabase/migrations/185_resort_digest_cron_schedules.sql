-- Migration 185: Resort Ops Digest — pg_cron schedules (Phase 4).
-- Mirrors the orit-cs-morning-digest cron pattern (migration 155).
-- Times below are UTC and target 07:00 Israel local during the current (summer,
-- UTC+3) DST period — same static-offset limitation as every other pg_cron job
-- in this system (no auto DST adjustment; drifts ~1h in winter).

DO $$
BEGIN
  PERFORM cron.unschedule('resort-digest-daily');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'resort-digest-daily',
  '0 4 * * *',
  $$
    SELECT net.http_post(
      url     := 'https://bunohsdggxyyzruubvcd.supabase.co/functions/v1/resort-digest-cron?period=daily',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);

DO $$
BEGIN
  PERFORM cron.unschedule('resort-digest-weekly');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'resort-digest-weekly',
  '0 4 * * 0',
  $$
    SELECT net.http_post(
      url     := 'https://bunohsdggxyyzruubvcd.supabase.co/functions/v1/resort-digest-cron?period=weekly',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);

DO $$
BEGIN
  PERFORM cron.unschedule('resort-digest-monthly');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'resort-digest-monthly',
  '0 4 1 * *',
  $$
    SELECT net.http_post(
      url     := 'https://bunohsdggxyyzruubvcd.supabase.co/functions/v1/resort-digest-cron?period=monthly',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);
