-- Orit CS Agent: production path = Microsoft Graph (M365 mailbox via OAuth).
-- Local dream-island.co.il forwards into the connected 365 inbox.

UPDATE public.orit_agent_mailbox
SET
  provider = 'microsoft',
  read_only_mode = true,
  auto_ack_enabled = false,
  imap_host = null,
  imap_username = null,
  imap_password = null
WHERE lower(owner_email) = 'orit@dream-island.co.il';

COMMENT ON COLUMN public.orit_agent_mailbox.provider IS
  'microsoft = Graph API (M365); imap = legacy Matrio read-only.';
