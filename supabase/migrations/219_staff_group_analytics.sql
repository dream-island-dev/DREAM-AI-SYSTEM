-- Migration 219: Staff Group Analytics — message log + housekeeping sender attribution.
-- Powers get_team_ops_analytics (Eliad executive assistant) and teamOpsAnalytics.ts.

CREATE TABLE IF NOT EXISTS public.staff_group_messages (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  wa_message_id     TEXT        NOT NULL,
  chat_id           TEXT        NOT NULL,
  group_key         TEXT        NOT NULL
                    CHECK (group_key IN ('ops_calls', 'housekeeping', 'guest_requests', 'managers', 'other')),
  from_phone        TEXT,
  from_name         TEXT,
  profile_id        UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  message_kind      TEXT        NOT NULL DEFAULT 'text'
                    CHECK (message_kind IN ('text', 'voice', 'reaction', 'image', 'other')),
  body_preview      TEXT,
  is_operational    BOOLEAN     NOT NULL DEFAULT false,
  operational_kind  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_staff_group_messages_wa_id UNIQUE (wa_message_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_group_messages_created
  ON public.staff_group_messages (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_staff_group_messages_group_created
  ON public.staff_group_messages (group_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_staff_group_messages_phone_created
  ON public.staff_group_messages (from_phone, created_at DESC)
  WHERE from_phone IS NOT NULL;

ALTER TABLE public.staff_group_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_group_messages_read_authenticated
  ON public.staff_group_messages FOR SELECT
  TO authenticated
  USING (true);

COMMENT ON TABLE public.staff_group_messages IS
  'Audit log of inbound Whapi group messages (ops, housekeeping, guest requests). '
  'Ingested by whapi-webhook — includes chitchat, not only tasks.';

-- Housekeeping WA events — who sent the signal (ready / check_in / check_out).
ALTER TABLE public.housekeeping_wa_events
  ADD COLUMN IF NOT EXISTS from_phone  TEXT,
  ADD COLUMN IF NOT EXISTS from_name   TEXT,
  ADD COLUMN IF NOT EXISTS profile_id  UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.housekeeping_wa_events.from_phone IS
  'Bare digits from Whapi sender — set on new events (migration 219).';
