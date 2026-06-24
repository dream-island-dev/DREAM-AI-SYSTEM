-- =============================================================================
-- 077_guest_request_routing_and_reactions.sql
-- Session 26 (XOS Core Sprint 3) — Dual-Routing Trigger + Reaction Listener +
-- Manager Bump support on the shared `tasks` table (Universal Architecture,
-- CLAUDE.md §0.4 — reuse the existing Ops & Maintenance Board plumbing instead
-- of building a parallel guest-request ticket system).
--
-- 1. tasks.source gains 'guest_request' — a suite guest's fulfillable ask
--    (log_guest_request, whatsapp-webhook) routed into the staff ops Whapi
--    group. Distinct from 'whatsapp_staff' (staff self-report) and
--    'inbox_routed' (operator manual routing, migration 075) — provenance
--    stays honest per source.
--
-- 2. tasks.guest_id — links a guest_request-sourced task back to guests(id),
--    mirroring reporter_profile_id's role for staff-sourced tasks (migration
--    071). Nullable / SET NULL — a deleted guest must never cascade-delete
--    operational history (ZERO DATA LOSS, CLAUDE.md §0.1).
--
-- 3. tasks.whapi_message_id — the outbound Whapi message id of the task's
--    notification card actually posted into the ops group (whichever flow
--    sent it: existing staff-report card OR the new guest-request card).
--    Sprint 2's reaction listener (whapi-webhook) resolves an inbound 👍🏼 by
--    looking up this column — one card per task, so UNIQUE partial index
--    mirrors source_message_id's idempotency convention (migration 073).
-- =============================================================================

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_source_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_source_check
  CHECK (source IN ('manual', 'whatsapp_staff', 'legacy_service_call', 'inbox_routed', 'guest_request'));

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS guest_id          BIGINT REFERENCES public.guests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS whapi_message_id  TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_whapi_message_id
  ON public.tasks (whapi_message_id)
  WHERE whapi_message_id IS NOT NULL;

COMMENT ON COLUMN public.tasks.source IS
  'manual = in-app New Task form. whatsapp_staff = parsed from the staff ops WhatsApp group (whapi-webhook, formerly staff-ops-webhook). legacy_service_call = one-time backfill (migration 071). inbox_routed = operator routed a guest WhatsApp conversation to Maintenance/Housekeeping from WhatsAppInbox.js. guest_request = a suite guest''s fulfillable ask (log_guest_request) auto-routed into the ops group (migration 077, Sprint 3.1) — day-guest/standard-room requests never reach this path, dashboard (guest_alerts) only.';
COMMENT ON COLUMN public.tasks.guest_id IS
  'Originating guests(id) for source=''guest_request'' tasks. NULL for every other source.';
COMMENT ON COLUMN public.tasks.whapi_message_id IS
  'Outbound Whapi message id of this task''s notification card in the ops group. Set right after the card send succeeds (whapi-webhook for both the staff-report and guest-request flows). The Sprint-2 reaction listener matches an inbound 👍🏼 action.target against this column to resolve the task without any link tap.';
