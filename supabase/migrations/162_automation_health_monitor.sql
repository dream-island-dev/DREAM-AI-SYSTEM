-- =============================================================================
-- 162_automation_health_monitor.sql
-- Phase 1 (DB only) of the automation health-watchdog approved by Mike
-- (session 2026-07-08): a proactive Whapi alert cron + a "🩺 בריאות אוטומציה"
-- ACC tab. This migration adds the two tables the watchdog needs — no
-- behavior changes yet, nothing writes to these tables until Phase 2
-- (automation-health-cron) is built and deployed.
--
-- cron_heartbeats: every scheduled Edge Function (starting with the existing
--   whatsapp-cron) upserts one row here at the START of its run. This is the
--   only way to know "is the cron even firing?" — automation-queue's Live
--   Queue is a DB *prediction*, it can look perfectly healthy even if the
--   actual dispatcher stopped running.
--
-- automation_health_alerts: one row per named health check (heartbeat
--   staleness, duplicate_blocked lookup_failed spike, failed/timeout rate,
--   ai_failover_events rate, per-template Meta approval status). Tracks
--   ok/alerting state + last_alerted_at so the watchdog can debounce —
--   an ongoing issue must not re-ping the ops Whapi group every 10 minutes.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.cron_heartbeats (
  job_name    TEXT PRIMARY KEY,
  last_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  meta        JSONB
);

COMMENT ON TABLE public.cron_heartbeats IS
  'One row per scheduled Edge Function job, upserted at the start of every run. Lets automation-health-cron detect a cron that silently stopped firing, which the Live Queue prediction alone cannot reveal.';

ALTER TABLE public.cron_heartbeats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cron_heartbeats_read" ON public.cron_heartbeats;
CREATE POLICY "cron_heartbeats_read" ON public.cron_heartbeats
  FOR SELECT TO authenticated USING (true);

-- Written by scheduled functions using the service-role key — no insert/update
-- policy needed for anon/authenticated, same convention as notification_log
-- and ai_failover_events (migration 072).

CREATE TABLE IF NOT EXISTS public.automation_health_alerts (
  check_key         TEXT PRIMARY KEY,
  status            TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'alerting')),
  first_detected_at TIMESTAMPTZ,
  last_alerted_at   TIMESTAMPTZ,
  last_checked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  detail            JSONB
);

COMMENT ON TABLE public.automation_health_alerts IS
  'One row per named automation health check. status flips ok<->alerting as automation-health-cron evaluates each run; last_alerted_at debounces repeat Whapi pings for an issue that is still open.';
COMMENT ON COLUMN public.automation_health_alerts.check_key IS
  'Stable identifier for the check, e.g. cron_heartbeat_wa_cron, duplicate_lookup_failed, notification_failed_rate, ai_failover_rate, template_approval:<meta_template_name>.';

CREATE INDEX IF NOT EXISTS idx_automation_health_alerts_status
  ON public.automation_health_alerts (status);

ALTER TABLE public.automation_health_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "automation_health_alerts_read" ON public.automation_health_alerts;
CREATE POLICY "automation_health_alerts_read" ON public.automation_health_alerts
  FOR SELECT TO authenticated USING (true);

-- Written by automation-health-cron using the service-role key — no
-- insert/update policy needed for anon/authenticated (same convention as above).

-- ── Self-test — both tables + expected columns exist ────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cron_heartbeats'
      AND column_name = 'last_run_at'
  ) THEN
    RAISE EXCEPTION '162_self_test: cron_heartbeats.last_run_at missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'automation_health_alerts'
      AND column_name = 'status'
  ) THEN
    RAISE EXCEPTION '162_self_test: automation_health_alerts.status missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.automation_health_alerts'::regclass
      AND conname = 'automation_health_alerts_status_check'
  ) THEN
    RAISE EXCEPTION '162_self_test: automation_health_alerts_status_check constraint missing';
  END IF;
END $$;

-- =============================================================================
-- END OF MIGRATION 162
-- =============================================================================
