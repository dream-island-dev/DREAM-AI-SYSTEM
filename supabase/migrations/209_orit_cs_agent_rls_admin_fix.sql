-- Fix Orit CS Agent RLS: restore admin + super_admin mailbox access (regression from 156).
-- UI tab is visible to admins; 156 narrowed RLS to super_admin + orit_cs_agent_access only.

CREATE OR REPLACE FUNCTION public.orit_agent_user_owns_mailbox(p_mailbox_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.orit_agent_mailbox m
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE m.id = p_mailbox_id
      AND (
        m.profile_id = auth.uid()
        OR lower(coalesce(p.email, '')) = lower(m.owner_email)
      )
  )
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (
        p.role IN ('super_admin', 'admin')
        OR p.orit_cs_agent_access = true
      )
  );
$$;

DROP POLICY IF EXISTS orit_agent_mailbox_select ON public.orit_agent_mailbox;
CREATE POLICY orit_agent_mailbox_select ON public.orit_agent_mailbox
  FOR SELECT TO authenticated
  USING (
    profile_id = auth.uid()
    OR lower(owner_email) = lower((SELECT email FROM public.profiles WHERE id = auth.uid()))
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('super_admin', 'admin')
          OR p.orit_cs_agent_access = true
        )
    )
  );

-- Safety: ensure mailbox row exists (OAuth may have run before migrations on a fresh env).
INSERT INTO public.orit_agent_mailbox (owner_email, email_address, provider, connection_status, read_only_mode)
VALUES ('orit@dream-island.co.il', 'orit@triobcom.onmicrosoft.com', 'microsoft', 'disconnected', true)
ON CONFLICT DO NOTHING;

UPDATE public.orit_agent_mailbox
SET provider = 'microsoft', read_only_mode = true, auto_ack_enabled = false
WHERE lower(owner_email) = 'orit@dream-island.co.il';
