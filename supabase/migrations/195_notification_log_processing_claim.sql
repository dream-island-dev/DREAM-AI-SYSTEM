-- Migration 195: durable claim-before-send for the WhatsApp automation pipeline.
--
-- Phase C of the 2026-07-13 retry-storm fix (Phase B = cooldown/exhausted
-- latch in _shared/automationRetryGate.ts, no schema). Phase B stops the
-- *spam* (same guest+trigger re-fired every ~15m); this migration enables a
-- narrower, separate hardening: preventing two overlapping cron ticks (or a
-- cron tick racing a manual ACC Override) from dispatching the SAME
-- guest+trigger concurrently.
--
-- notification_log.status already reserves 'processing' (migration
-- 139_duplicate_blocked_status.sql) but nothing writes it yet. This index
-- makes "at most one in-flight attempt per (guest, trigger)" a
-- Postgres-enforced invariant instead of a hope — mirrors the exact
-- partial-unique-index pattern already used for the sent/simulated dedup
-- (006_operations_v2.sql, superseded by 088_notification_log_idempotency_index.sql).
--
-- _shared/automationClaim.ts INSERTs a 'processing' row before calling
-- Whapi/Meta and UPDATEs that same row to its final status afterward
-- (sent|simulated|timeout|failed|blocked_by_meta) — never a second INSERT —
-- so this index naturally releases once the attempt finalizes.

CREATE UNIQUE INDEX IF NOT EXISTS uq_notif_guest_trigger_processing
  ON public.notification_log (guest_id, trigger_type)
  WHERE guest_id IS NOT NULL AND status = 'processing';

COMMENT ON INDEX uq_notif_guest_trigger_processing IS
  'Phase C claim-before-send (2026-07-13): at most one in-flight (processing) dispatch attempt per guest+trigger. See _shared/automationClaim.ts.';
