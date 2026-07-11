-- =============================================================================
-- 186_handoff_escalated_at.sql
-- Soft Inbox handoff SLA idempotency (Hybrid unanswered-guest escalation).
--
-- sla-escalation-cron pages duty reception when a soft human_requested row
-- (spa / late checkout / finance / generic staff_handoff) sits unanswered past
-- SOFT_HANDOFF_SLA_MINUTES. handoff_escalated_at prevents re-paging every minute.
-- Hard path (pending_approval auto-approve) does NOT use this column — those
-- tasks flip to status='open' via notify-manual-task and drop out of the scan.
-- =============================================================================

ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS handoff_escalated_at TIMESTAMPTZ;

COMMENT ON COLUMN public.whatsapp_conversations.handoff_escalated_at IS
  'Set by sla-escalation-cron the first time a soft (non-ops) human_requested inbound crosses the soft-handoff SLA and duty reception is notified. NULL = not yet escalated. Operational room requests use tasks.pending_approval auto-approve instead.';

CREATE INDEX IF NOT EXISTS idx_wa_conv_soft_handoff_escalation
  ON public.whatsapp_conversations (created_at)
  WHERE human_requested = true AND handoff_escalated_at IS NULL;
