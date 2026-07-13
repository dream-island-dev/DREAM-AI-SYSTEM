-- 201: Guest Club membership (opt-in after survey) — Approach A MVP
-- Consent store only. Marketing sends come later (Whapi / Meta templates).
-- UNIQUE(phone) = one membership row per WhatsApp identity (Golden Profile sync).

CREATE TABLE IF NOT EXISTS public.guest_club_members (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id              BIGINT      REFERENCES public.guests(id) ON DELETE SET NULL,
  phone                 TEXT        NOT NULL,
  status                TEXT        NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'declined', 'opted_out')),
  source                TEXT        NOT NULL DEFAULT 'survey_portal',
  opted_in_at           TIMESTAMPTZ,
  opted_out_at          TIMESTAMPTZ,
  declined_at           TIMESTAMPTZ,
  portal_token_snapshot UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (phone)
);

CREATE INDEX IF NOT EXISTS idx_guest_club_members_status
  ON public.guest_club_members (status, opted_in_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_guest_club_members_guest_id
  ON public.guest_club_members (guest_id);

ALTER TABLE public.guest_club_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "guest_club_members_auth_all"
  ON public.guest_club_members FOR ALL
  USING (auth.uid() IS NOT NULL);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'guest_club_members'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.guest_club_members;
  END IF;
END $$;

-- Soft denorm for staff dashboards (NULL = never asked / unknown).
ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS club_status TEXT
    CHECK (club_status IS NULL OR club_status IN ('active', 'declined', 'opted_out'));

COMMENT ON TABLE public.guest_club_members IS
  'Dream Island customer club — WhatsApp marketing consent. Writes via guest-portal-club (service role).';
