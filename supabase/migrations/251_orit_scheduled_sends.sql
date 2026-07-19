-- Orit CS: scheduled guest outbound (email / WhatsApp bridge) — UI + Sigal WA.

CREATE TABLE IF NOT EXISTS public.orit_agent_scheduled_sends (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id       UUID        NOT NULL REFERENCES public.orit_agent_threads(id) ON DELETE CASCADE,
  mailbox_id      UUID        NOT NULL REFERENCES public.orit_agent_mailbox(id) ON DELETE CASCADE,
  channel         TEXT        NOT NULL CHECK (channel IN ('email', 'whatsapp_bridge')),
  draft_kind      TEXT        NOT NULL CHECK (draft_kind IN ('ack', 'full_reply')),
  body_text       TEXT        NOT NULL,
  scheduled_for   TIMESTAMPTZ NOT NULL,
  mark_handled    BOOLEAN     NOT NULL DEFAULT false,
  draft_id        UUID        REFERENCES public.orit_agent_drafts(id) ON DELETE SET NULL,
  status          TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'cancelled', 'failed')),
  source          TEXT        NOT NULL DEFAULT 'ui' CHECK (source IN ('ui', 'sigal_wa')),
  created_by      UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  error_message   TEXT,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orit_scheduled_sends_pending_due
  ON public.orit_agent_scheduled_sends (scheduled_for)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_orit_scheduled_sends_thread_pending
  ON public.orit_agent_scheduled_sends (thread_id)
  WHERE status = 'pending';

COMMENT ON TABLE public.orit_agent_scheduled_sends IS
  'Staff-scheduled Orit guest replies — dispatched by whatsapp-cron when due.';

ALTER TABLE public.orit_agent_scheduled_sends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orit_scheduled_sends_select ON public.orit_agent_scheduled_sends;
CREATE POLICY orit_scheduled_sends_select ON public.orit_agent_scheduled_sends
  FOR SELECT TO authenticated
  USING (public.orit_agent_user_owns_mailbox(mailbox_id));

DROP POLICY IF EXISTS orit_scheduled_sends_insert ON public.orit_agent_scheduled_sends;
CREATE POLICY orit_scheduled_sends_insert ON public.orit_agent_scheduled_sends
  FOR INSERT TO authenticated
  WITH CHECK (public.orit_agent_user_owns_mailbox(mailbox_id));

DROP POLICY IF EXISTS orit_scheduled_sends_update ON public.orit_agent_scheduled_sends;
CREATE POLICY orit_scheduled_sends_update ON public.orit_agent_scheduled_sends
  FOR UPDATE TO authenticated
  USING (public.orit_agent_user_owns_mailbox(mailbox_id))
  WITH CHECK (public.orit_agent_user_owns_mailbox(mailbox_id));
