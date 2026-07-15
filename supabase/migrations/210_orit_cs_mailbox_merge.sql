-- Merge duplicate Orit mailboxes: OAuth landed on triobcom row; canonical owner is dream-island.co.il.

DO $$
DECLARE
  v_active_id UUID := 'a89bd84c-85e5-4791-a21a-b5bcb8619549';
  v_dup_id    UUID := '3ec450ea-761d-44d2-a4b3-fc89cf9e72a9';
BEGIN
  -- Repoint any threads on the duplicate empty row (if any).
  UPDATE public.orit_agent_threads
  SET mailbox_id = v_active_id
  WHERE mailbox_id = v_dup_id;

  DELETE FROM public.orit_agent_mailbox WHERE id = v_dup_id;

  UPDATE public.orit_agent_mailbox
  SET
    owner_email = 'orit@dream-island.co.il',
    email_address = coalesce(email_address, 'orit@triobcom.onmicrosoft.com'),
    provider = 'microsoft',
    read_only_mode = true,
    auto_ack_enabled = false
  WHERE id = v_active_id;
END $$;

-- Orit + support logins
UPDATE public.profiles
SET orit_cs_agent_access = true
WHERE lower(coalesce(email, '')) IN (
  'orit@dream.io',
  'orit@dream-island.co.il',
  'mikeka13@gmail.com',
  'tzalamnadlan@gmail.com'
);

-- One canonical mailbox only (idempotent guard).
CREATE UNIQUE INDEX IF NOT EXISTS uq_orit_agent_mailbox_owner_email
  ON public.orit_agent_mailbox (lower(owner_email));
