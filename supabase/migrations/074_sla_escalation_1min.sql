-- =============================================================================
-- 074_sla_escalation_1min.sql
-- Sprint 2 follow-up — strict 7-minute "unassigned task" SLA escalation.
--
-- Tightens the EXISTING `sla-escalation` pg_cron job (migration 066) from a
-- 5-minute cadence to every 1 minute, so an unassigned-task breach is caught
-- within ~60s of crossing the 7-minute line. This re-schedules the SAME named
-- job (unschedule + reschedule) — there is exactly ONE SLA cron, never a
-- parallel second one (the "no duplicate systems" rule, CLAUDE.md §0/§5).
--
-- NO schema change: the scanner's idempotency marker `tasks.escalated_at`
-- already exists (migration 071), and the 7-minute window is computed in the
-- Edge Function from `tasks.created_at` (configurable via SLA_UNASSIGNED_MINUTES).
--
-- Going live still requires the function's own kill switch:
--   SLA_ESCALATION_ENABLED=true  in Supabase Secrets (unchanged from session 21).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Drop the old */5 schedule for this job (no-op if it isn't scheduled).
DO $$
BEGIN
  PERFORM cron.unschedule('sla-escalation');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Reschedule the same job name, now every minute.
SELECT cron.schedule(
  'sla-escalation',
  '* * * * *',                       -- every 1 minute (was '*/5 * * * *')
  $$
    SELECT net.http_post(
      url     := 'https://bunohsdggxyyzruubvcd.supabase.co/functions/v1/sla-escalation-cron',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);

-- ── Going-live baseline (CRITICAL) ──────────────────────────────────────────
-- Grandfather every task that is ALREADY 'open' at the moment SLA goes live, so
-- the ops group is NOT retroactively blasted with 🚨 alerts for the existing
-- backlog the instant the 1-min cron + kill switch turn on. Only tasks that
-- become 'open' AFTER this migration will escalate. escalated_at is the
-- scanner's idempotency marker, so setting it here = "already accounted for".
-- Idempotent: a no-op on re-run once these rows are stamped.
UPDATE public.tasks
  SET escalated_at = NOW()
  WHERE status = 'open' AND escalated_at IS NULL;
