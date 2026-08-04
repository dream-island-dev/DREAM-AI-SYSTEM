-- Migration 285: covering index for notification_log's retry/history lookups.
--
-- Two hot per-tick queries filter notification_log by guest_id + a sent_at
-- window, then narrow further by status or trigger_type in-memory:
--   - whatsapp-cron/index.ts (~line 356): retry-gate lookup —
--       .in("guest_id", ...).in("status", ["timeout","failed","blocked_by_meta","processing"]).gte("sent_at", ...)
--   - automation-queue/index.ts (~line 179): 7-day Live Queue history —
--       .in("guest_id", ...).in("trigger_type", ...).gte("sent_at", ...).order("sent_at", desc)
--
-- The only existing indexes (006_operations_v2.sql, superseded by
-- 088_notification_log_idempotency_index.sql and
-- 195_notification_log_processing_claim.sql) are UNIQUE PARTIAL indexes on
-- (guest_id, trigger_type) scoped to status IN ('sent','simulated') or
-- status = 'processing' — built for insert-time idempotency, not for these
-- read patterns. Neither query's status/trigger_type filter matches a single
-- partial index's WHERE clause, so Postgres cannot use them here; both
-- queries fall back to a sequential scan bounded only by the guest_id
-- IN-list, which gets slower as notification_log accumulates one row per
-- automation attempt per guest (grows directly with day-pass guest volume).
--
-- guest_id is the shared, highly-selective leading filter in both queries,
-- and both range-filter on sent_at — a plain (non-partial) composite index
-- on exactly those two columns lets Postgres narrow to the right guest+date
-- window via an index scan, then cheaply filter status/trigger_type from
-- that already-small candidate set in memory.

CREATE INDEX IF NOT EXISTS idx_notification_log_guest_sent_at
  ON public.notification_log (guest_id, sent_at DESC);

COMMENT ON INDEX public.idx_notification_log_guest_sent_at IS
  'Scalability fix (2026-08-04): serves whatsapp-cron''s retry-gate lookup and automation-queue''s Live Queue history query, both of which filter by guest_id + sent_at range with no matching index before this — see migration 285 header for detail.';
