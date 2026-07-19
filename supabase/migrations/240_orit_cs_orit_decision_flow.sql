-- Orit CS: human-in-the-loop reply choice (email ack vs WhatsApp) via Sigal Whapi DM.

ALTER TABLE public.orit_agent_threads
  ADD COLUMN IF NOT EXISTS orit_decision TEXT
    CHECK (orit_decision IS NULL OR orit_decision IN ('pending', 'email_ack', 'whatsapp', 'manual')),
  ADD COLUMN IF NOT EXISTS orit_decision_prompted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS orit_decision_at TIMESTAMPTZ;

COMMENT ON COLUMN public.orit_agent_threads.orit_decision IS
  'Sigal prompt outcome: pending | email_ack | whatsapp | manual (handled in UI without auto-ack).';
COMMENT ON COLUMN public.orit_agent_threads.orit_decision_prompted_at IS
  'When Sigal asked Orit (Whapi) to choose email ack vs WhatsApp.';
COMMENT ON COLUMN public.orit_agent_threads.orit_decision_at IS
  'When Orit answered the Whapi prompt (or staff chose in UI).';

CREATE INDEX IF NOT EXISTS idx_orit_agent_threads_decision_pending
  ON public.orit_agent_threads (mailbox_id, orit_decision_prompted_at DESC)
  WHERE orit_decision = 'pending';
