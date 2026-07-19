-- Orit CS — WhatsApp bridge when guest has phone but no email.

ALTER TABLE public.orit_agent_threads
  ADD COLUMN IF NOT EXISTS orit_wa_contact_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS guest_wa_reply_notified_at TIMESTAMPTZ;

COMMENT ON COLUMN public.orit_agent_threads.orit_wa_contact_at IS
  'First outbound WhatsApp to guest via suites device (no-email bridge).';
COMMENT ON COLUMN public.orit_agent_threads.guest_wa_reply_notified_at IS
  'Last Sigal WA alert to Orit after guest replied on WhatsApp bridge thread.';
