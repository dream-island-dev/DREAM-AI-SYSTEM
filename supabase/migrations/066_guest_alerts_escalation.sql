-- =============================================================================
-- 066_guest_alerts_escalation.sql
-- Tier 2 SLA escalation — guest_alerts.escalated_at + pg_cron schedule.
--
-- WHY escalated_at:
--   Without an idempotency marker, a cron that scans for "unresolved alerts
--   older than 10 minutes" would re-notify Tier 2 staff on EVERY run (every
--   5 minutes, indefinitely) for the same overdue alert — exactly the kind
--   of repeat-spam bug this codebase has fixed before for guest-facing sends
--   (notification_log idempotency, msg_*_sent flags). escalated_at is the
--   same pattern applied to staff-facing escalation: set once, by
--   sla-escalation-cron, the first time an alert crosses the threshold.
--
-- Separate dedicated pg_cron job (not folded into the existing "wa-cron"/
-- "whatsapp-triggers" job) — Tier 2 staff escalation is a different concern
-- from the guest-facing automation pipeline and should be independently
-- toggleable (own kill switch, see sla-escalation-cron/index.ts) without
-- affecting or being affected by CRON_ENABLED/AUTOMATION_ENABLED.
-- =============================================================================

ALTER TABLE public.guest_alerts
  ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;

COMMENT ON COLUMN public.guest_alerts.escalated_at IS
  'Set by sla-escalation-cron the first time this unresolved alert crosses the 10-minute SLA threshold and Tier 2 staff are notified. NULL = not yet escalated. Prevents re-notifying staff on every cron run for the same overdue alert.';

CREATE INDEX IF NOT EXISTS idx_guest_alerts_sla_scan
  ON public.guest_alerts (resolved, escalated_at, created_at)
  WHERE resolved = false AND escalated_at IS NULL;

-- ── pg_cron schedule — mirrors migration 007's exact pattern (no auth header
--    needed; the function is deployed --no-verify-jwt). Checks every 5 min
--    against a 10-min SLA threshold for reasonable precision without churn.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  PERFORM cron.unschedule('sla-escalation');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'sla-escalation',
  '*/5 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://bunohsdggxyyzruubvcd.supabase.co/functions/v1/sla-escalation-cron',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);
