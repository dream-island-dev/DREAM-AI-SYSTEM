-- Orit CS: two-phase workflow (ack approval → full reply approval) + guest reply tracking.

ALTER TABLE public.orit_agent_threads
  ADD COLUMN IF NOT EXISTS workflow_step TEXT
    CHECK (workflow_step IS NULL OR workflow_step IN (
      'awaiting_ack_approval',
      'ack_sent',
      'awaiting_reply_approval',
      'reply_sent',
      'guest_replied'
    )),
  ADD COLUMN IF NOT EXISTS full_reply_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS guest_reply_notified_at TIMESTAMPTZ;

COMMENT ON COLUMN public.orit_agent_threads.workflow_step IS
  'Serious complaint HITL: awaiting_ack_approval → ack_sent → awaiting_reply_approval → reply_sent → guest_replied.';
COMMENT ON COLUMN public.orit_agent_threads.full_reply_sent_at IS
  'When Orit approved and sent the full complaint response email.';
COMMENT ON COLUMN public.orit_agent_threads.guest_reply_notified_at IS
  'Last Whapi alert to Orit after guest replied inbound.';

ALTER TABLE public.orit_agent_drafts
  ADD COLUMN IF NOT EXISTS draft_kind TEXT NOT NULL DEFAULT 'full_reply'
    CHECK (draft_kind IN ('ack', 'full_reply'));

CREATE INDEX IF NOT EXISTS idx_orit_agent_drafts_thread_kind
  ON public.orit_agent_drafts (thread_id, draft_kind, status);

CREATE INDEX IF NOT EXISTS idx_orit_agent_threads_workflow
  ON public.orit_agent_threads (mailbox_id, workflow_step, received_at DESC)
  WHERE workflow_step IS NOT NULL;
