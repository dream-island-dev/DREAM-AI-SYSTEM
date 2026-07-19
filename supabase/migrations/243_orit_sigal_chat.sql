-- Orit Sigal chat: pending confirm-before-send state (WA / voice).

ALTER TABLE public.orit_agent_threads
  ADD COLUMN IF NOT EXISTS orit_chat_pending JSONB;

COMMENT ON COLUMN public.orit_agent_threads.orit_chat_pending IS
  'Sigal chat confirm gate: {action: confirm_ack|confirm_full, body_text, shown_at}. Cleared after send.';
