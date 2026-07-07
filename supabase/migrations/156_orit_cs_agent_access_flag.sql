-- Orit CS Agent — per-user access flag (managed in User Management by super_admin)

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS orit_cs_agent_access BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.orit_cs_agent_access IS
  'When true, user sees the Orit Customer Service Agent tab and mailbox RLS. Set by super_admin in User Management.';

-- Seed known owner logins
UPDATE public.profiles
SET orit_cs_agent_access = true
WHERE lower(coalesce(email, '')) IN ('orit@dream.io', 'orit@dream-island.co.il');

-- Link mailbox profile_id where emails match
UPDATE public.orit_agent_mailbox m
SET profile_id = p.id
FROM public.profiles p
WHERE m.profile_id IS NULL
  AND lower(p.email) = lower(m.owner_email);

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
      AND (p.role = 'super_admin' OR p.orit_cs_agent_access = true)
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
        AND (p.role = 'super_admin' OR p.orit_cs_agent_access = true)
    )
  );
