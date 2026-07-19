-- Sigal gentle reminder cooldown for open Orit CS complaints.

ALTER TABLE public.orit_agent_threads
  ADD COLUMN IF NOT EXISTS sigal_last_reminder_at TIMESTAMPTZ;

COMMENT ON COLUMN public.orit_agent_threads.sigal_last_reminder_at IS
  'Last Whapi reminder from Sigal when a complaint thread stays open without Orit action.';
