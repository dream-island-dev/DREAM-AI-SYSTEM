-- Reliable mailbox fetch for Orit CS UI (SECURITY DEFINER — no oauth secrets to client).

CREATE OR REPLACE FUNCTION public.get_orit_cs_mailbox()
RETURNS TABLE (
  id                    UUID,
  profile_id            UUID,
  owner_email           TEXT,
  email_address         TEXT,
  provider              TEXT,
  connection_status     TEXT,
  read_only_mode        BOOLEAN,
  last_sync_at          TIMESTAMPTZ,
  sla_hours             INT,
  digest_enabled        BOOLEAN,
  connection_error      TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.id,
    m.profile_id,
    m.owner_email,
    m.email_address,
    m.provider,
    m.connection_status,
    m.read_only_mode,
    m.last_sync_at,
    m.sla_hours,
    m.digest_enabled,
    m.connection_error
  FROM public.orit_agent_mailbox m
  WHERE public.orit_agent_user_owns_mailbox(m.id)
  ORDER BY
    CASE WHEN m.connection_status = 'active' THEN 0 ELSE 1 END,
    m.last_sync_at DESC NULLS LAST,
    m.created_at ASC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_orit_cs_mailbox() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_orit_cs_mailbox() TO authenticated;

COMMENT ON FUNCTION public.get_orit_cs_mailbox IS
  'Safe Orit CS mailbox row for UI (excludes oauth_refresh_token / imap_password).';
