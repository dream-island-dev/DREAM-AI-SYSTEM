-- Orit CS: Sigal Whapi urgent alerts + digest phone on mailbox.

ALTER TABLE public.orit_agent_mailbox
  ADD COLUMN IF NOT EXISTS digest_whatsapp_phone TEXT,
  ADD COLUMN IF NOT EXISTS alert_enabled       BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.orit_agent_mailbox.digest_whatsapp_phone IS
  'WhatsApp digits or E.164 — Sigal DM for urgent thread alerts and morning digest fallback.';
COMMENT ON COLUMN public.orit_agent_mailbox.alert_enabled IS
  'When false, skip per-thread Whapi alerts (morning digest still controlled by digest_enabled).';

UPDATE public.orit_agent_mailbox
SET digest_whatsapp_phone = '+972504056101'
WHERE lower(owner_email) = 'orit@dream-island.co.il'
  AND coalesce(trim(digest_whatsapp_phone), '') = '';

CREATE TABLE IF NOT EXISTS public.orit_agent_alert_log (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  mailbox_id        UUID        NOT NULL REFERENCES public.orit_agent_mailbox(id) ON DELETE CASCADE,
  thread_id         UUID        NOT NULL REFERENCES public.orit_agent_threads(id) ON DELETE CASCADE,
  body_sent         TEXT        NOT NULL,
  whapi_message_id  TEXT,
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (thread_id)
);

CREATE INDEX IF NOT EXISTS idx_orit_agent_alert_log_mailbox_sent
  ON public.orit_agent_alert_log (mailbox_id, sent_at DESC);

ALTER TABLE public.orit_agent_alert_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orit_agent_alert_select ON public.orit_agent_alert_log;
CREATE POLICY orit_agent_alert_select ON public.orit_agent_alert_log
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.orit_agent_threads t
      WHERE t.id = thread_id
        AND public.orit_agent_user_owns_mailbox(t.mailbox_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('super_admin', 'admin')
    )
  );

DROP FUNCTION IF EXISTS public.get_orit_cs_mailbox();
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
  digest_whatsapp_phone TEXT,
  alert_enabled         BOOLEAN,
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
    m.digest_whatsapp_phone,
    m.alert_enabled,
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
