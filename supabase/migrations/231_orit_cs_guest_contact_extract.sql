-- Orit CS Agent: persist guest contact extracted from website form email bodies.

ALTER TABLE public.orit_agent_threads
  ADD COLUMN IF NOT EXISTS guest_contact_email TEXT,
  ADD COLUMN IF NOT EXISTS guest_contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS guest_contact_name  TEXT;

COMMENT ON COLUMN public.orit_agent_threads.guest_contact_email IS
  'Guest email parsed from inbound form body (דוא"ל: …) — reply target when present.';
COMMENT ON COLUMN public.orit_agent_threads.guest_contact_phone IS
  'Guest phone parsed from inbound form body (E.164 +972…) — WhatsApp deep-link.';
COMMENT ON COLUMN public.orit_agent_threads.guest_contact_name IS
  'Guest name parsed from inbound form body (שם מלא: …).';

CREATE INDEX IF NOT EXISTS idx_orit_agent_threads_guest_contact_email
  ON public.orit_agent_threads (mailbox_id, guest_contact_email)
  WHERE guest_contact_email IS NOT NULL;
