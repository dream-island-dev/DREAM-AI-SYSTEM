-- =============================================================================
-- 050_notification_log_timeout_status.sql
-- session 9 introduced a third notification_log.status value, "timeout"
-- (Meta fetch timed out — outcome unknown, distinct from a confirmed "failed"
-- rejection — see whatsapp-send/index.ts and whatsapp-webhook/index.ts).
-- The original CHECK constraint (migration 006) only allows
-- ('sent', 'simulated', 'failed'), so every "timeout" insert since session 9
-- has been silently rejected by Postgres and swallowed by the caller (the
-- insert isn't error-checked) — the row was simply never written. This widens
-- the constraint so those rows actually land, which the Pipeline Monitor
-- (session 11) depends on to show "Meta never confirmed" sends distinctly
-- from confirmed failures.
-- =============================================================================

ALTER TABLE public.notification_log DROP CONSTRAINT IF EXISTS notification_log_status_check;

ALTER TABLE public.notification_log
  ADD CONSTRAINT notification_log_status_check
  CHECK (status IN ('sent', 'simulated', 'failed', 'timeout'));
