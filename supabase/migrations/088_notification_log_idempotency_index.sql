-- =============================================================================
-- 088_notification_log_idempotency_index.sql
-- "CTO AUDIT" session — fixes a real race condition found while auditing the
-- Stage 2/2.5 automation flow.
--
-- migration 006 created `uq_notif_guest_trigger` as a flat UNIQUE INDEX on
-- (guest_id, trigger_type) with no status filter — i.e. only ONE row, ever,
-- can exist per guest+trigger pair, regardless of its status.
--
-- whatsapp-send/index.ts's BRANCH D (the pipeline sender) intentionally
-- allows retries after a "failed"/"timeout" row (the existing-check only
-- excludes status IN ('sent','simulated') — see that file's comment at the
-- idempotency check). But its insert at the end of BRANCH D is a bare
-- `.insert()` with no error check. Once a guest+trigger pair has ANY row
-- (even a first failed attempt), every later insert for that same pair
-- — including the eventual successful retry — collides with the old row
-- under this flat unique index and is silently dropped by Postgres.
--
-- Net effect: the guest is NOT double-messaged (guests.msg_*_sent is stamped
-- independently of this insert, see whatsapp-send/index.ts ~line 860), but
-- Automation History / the Pipeline Monitor permanently shows "failed" for
-- that guest+trigger even after a real successful send — a silent FAIL
-- VISIBLE violation in the project's own observability tooling.
--
-- FIX: scope the unique constraint to the only case that actually needs
-- exclusivity — preventing two "sent"/"simulated" rows for the same
-- guest+trigger. Failed/timeout rows are now free to accumulate, exactly as
-- whatsapp-send/index.ts's own comment already assumed.
-- =============================================================================

DROP INDEX IF EXISTS public.uq_notif_guest_trigger;

CREATE UNIQUE INDEX IF NOT EXISTS uq_notif_guest_trigger_sent
  ON public.notification_log (guest_id, trigger_type)
  WHERE guest_id IS NOT NULL AND status IN ('sent', 'simulated');

COMMENT ON INDEX public.uq_notif_guest_trigger_sent IS
  'Replaces the unscoped uq_notif_guest_trigger (migration 006). Only blocks a second sent/simulated row per guest+trigger — failed/timeout rows may accumulate across retries without colliding, fixing a silent insert-drop that made Automation History show stale "failed" status after a later successful retry.';
