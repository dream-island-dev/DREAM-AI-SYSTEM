-- Sigal evening wrap-up + morning digest at 07:00 Israel (UTC+3 summer).

ALTER TABLE public.orit_agent_digest_log
  ADD COLUMN IF NOT EXISTS digest_kind TEXT NOT NULL DEFAULT 'morning';

ALTER TABLE public.orit_agent_digest_log
  DROP CONSTRAINT IF EXISTS orit_agent_digest_log_mailbox_id_digest_date_key;

ALTER TABLE public.orit_agent_digest_log
  ADD CONSTRAINT orit_agent_digest_log_kind_check
  CHECK (digest_kind IN ('morning', 'evening'));

ALTER TABLE public.orit_agent_digest_log
  ADD CONSTRAINT orit_agent_digest_log_mailbox_kind_unique
  UNIQUE (mailbox_id, digest_date, digest_kind);

DO $$
BEGIN
  PERFORM cron.unschedule('orit-cs-morning-digest');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'orit-cs-morning-digest',
  '0 4 * * *',
  $$
    SELECT net.http_post(
      url     := 'https://bunohsdggxyyzruubvcd.supabase.co/functions/v1/manager-morning-digest',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);

DO $$
BEGIN
  PERFORM cron.unschedule('orit-cs-evening-digest');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'orit-cs-evening-digest',
  '0 15 * * *',
  $$
    SELECT net.http_post(
      url     := 'https://bunohsdggxyyzruubvcd.supabase.co/functions/v1/manager-evening-digest',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);
