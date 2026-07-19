-- Orit CS Agent: super_admin always; others only via profiles.orit_cs_agent_access (User Management).
-- Reverts admin bypass from migration 209; keeps super_admin support access.

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
        p.role = 'super_admin'
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
          p.role = 'super_admin'
          OR p.orit_cs_agent_access = true
        )
    )
  );
