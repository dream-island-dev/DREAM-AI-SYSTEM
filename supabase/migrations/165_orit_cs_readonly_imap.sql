-- Orit CS Agent: read-only mode + IMAP provider (Hosted Exchange / Matrio).
-- Orit copies AI drafts and sends manually from her mail client.

ALTER TABLE public.orit_agent_mailbox
  DROP CONSTRAINT IF EXISTS orit_agent_mailbox_provider_check;

ALTER TABLE public.orit_agent_mailbox
  ADD COLUMN IF NOT EXISTS read_only_mode BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS imap_host TEXT,
  ADD COLUMN IF NOT EXISTS imap_port INT NOT NULL DEFAULT 993,
  ADD COLUMN IF NOT EXISTS imap_username TEXT,
  ADD COLUMN IF NOT EXISTS imap_password TEXT,
  ADD COLUMN IF NOT EXISTS imap_tls BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.orit_agent_mailbox
  ALTER COLUMN provider SET DEFAULT 'imap';

ALTER TABLE public.orit_agent_mailbox
  ADD CONSTRAINT orit_agent_mailbox_provider_check
  CHECK (provider IN ('microsoft', 'imap'));

COMMENT ON COLUMN public.orit_agent_mailbox.read_only_mode IS
  'When true, XOS never sends mail — Orit copies drafts and replies from Outlook.';
COMMENT ON COLUMN public.orit_agent_mailbox.imap_password IS
  'Service-role only. Prefer ORIT_IMAP_* Supabase secrets; column optional override.';

UPDATE public.orit_agent_mailbox
SET
  provider = 'imap',
  read_only_mode = TRUE,
  auto_ack_enabled = FALSE,
  connection_status = CASE
    WHEN connection_status = 'active' AND provider = 'microsoft' THEN 'disconnected'
    ELSE connection_status
  END
WHERE lower(owner_email) = 'orit@dream-island.co.il';

-- SLA starts at received_at (not after auto-ack) for open threads missing deadline.
UPDATE public.orit_agent_threads t
SET sla_deadline_at = t.received_at + (m.sla_hours || ' hours')::INTERVAL
FROM public.orit_agent_mailbox m
WHERE t.mailbox_id = m.id
  AND t.is_demo = FALSE
  AND t.sla_deadline_at IS NULL
  AND t.received_at IS NOT NULL;
