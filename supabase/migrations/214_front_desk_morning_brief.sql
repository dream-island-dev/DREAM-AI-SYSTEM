-- Migration 214: Front desk morning brief — idempotency log + pg_cron (07:00 Israel / 04:00 UTC summer).
-- Sends Adir a daily Whapi DM with suite arrivals + open requests + assistant onboarding.

CREATE TABLE IF NOT EXISTS public.front_desk_morning_log (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  digest_date   DATE        NOT NULL UNIQUE,
  body_sent     TEXT        NOT NULL,
  wa_message_id TEXT,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.front_desk_morning_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY front_desk_morning_log_select ON public.front_desk_morning_log
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

DO $$
BEGIN
  PERFORM cron.unschedule('front-desk-morning-brief');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'front-desk-morning-brief',
  '0 4 * * *',
  $$
    SELECT net.http_post(
      url     := 'https://bunohsdggxyyzruubvcd.supabase.co/functions/v1/front-desk-morning-cron',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);
