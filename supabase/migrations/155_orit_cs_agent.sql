-- Migration 155: Orit Customer Service Agent — mailbox, threads, SLA 72h auto-ack.
-- Independent from guest WA bot. Ready before Outlook OAuth is connected.

CREATE TABLE IF NOT EXISTS public.orit_agent_mailbox (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id            UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  owner_email           TEXT        NOT NULL,
  email_address         TEXT,
  provider              TEXT        NOT NULL DEFAULT 'microsoft'
                        CHECK (provider IN ('microsoft')),
  connection_status     TEXT        NOT NULL DEFAULT 'disconnected'
                        CHECK (connection_status IN ('disconnected', 'pending', 'active', 'error')),
  oauth_refresh_token   TEXT,
  token_expires_at      TIMESTAMPTZ,
  last_sync_at          TIMESTAMPTZ,
  sync_cursor           TEXT,
  auto_ack_enabled      BOOLEAN     NOT NULL DEFAULT TRUE,
  auto_ack_template     TEXT        NOT NULL DEFAULT
    'שלום {{GUEST_NAME}},

קיבלנו את פנייתך בנושא «{{SUBJECT}}».
צוות דרים איילנד יחזור אליך תוך 72 שעות.

תודה על סבלנותך,
דרים איילנד — אתר הנופש',
  sla_hours             INT         NOT NULL DEFAULT 72,
  digest_enabled        BOOLEAN     NOT NULL DEFAULT TRUE,
  digest_local_time     TEXT        NOT NULL DEFAULT '06:30',
  connection_error      TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_orit_agent_mailbox_owner_email
  ON public.orit_agent_mailbox (lower(owner_email));

CREATE UNIQUE INDEX IF NOT EXISTS uq_orit_agent_mailbox_profile
  ON public.orit_agent_mailbox (profile_id)
  WHERE profile_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_orit_agent_mailbox_updated ON public.orit_agent_mailbox;
CREATE TRIGGER trg_orit_agent_mailbox_updated
  BEFORE UPDATE ON public.orit_agent_mailbox
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.orit_agent_threads (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  mailbox_id            UUID        NOT NULL REFERENCES public.orit_agent_mailbox(id) ON DELETE CASCADE,
  graph_conversation_id TEXT,
  external_thread_key   TEXT        NOT NULL,
  subject               TEXT        NOT NULL DEFAULT '',
  from_email            TEXT        NOT NULL DEFAULT '',
  from_name             TEXT,
  received_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  snippet               TEXT,
  status                TEXT        NOT NULL DEFAULT 'awaiting_reply'
                        CHECK (status IN ('awaiting_reply', 'handled', 'snoozed', 'archived')),
  urgency               TEXT        NOT NULL DEFAULT 'normal'
                        CHECK (urgency IN ('critical', 'high', 'normal', 'low')),
  urgency_reason        TEXT,
  category              TEXT        NOT NULL DEFAULT 'other'
                        CHECK (category IN ('complaint', 'booking', 'spa', 'vendor', 'internal', 'other')),
  guest_id              BIGINT      REFERENCES public.guests(id) ON DELETE SET NULL,
  ai_summary            TEXT,
  ai_analyzed_at        TIMESTAMPTZ,
  auto_ack_sent_at      TIMESTAMPTZ,
  sla_deadline_at       TIMESTAMPTZ,
  handled_at            TIMESTAMPTZ,
  is_demo               BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (mailbox_id, external_thread_key)
);

CREATE INDEX IF NOT EXISTS idx_orit_agent_threads_mailbox_status
  ON public.orit_agent_threads (mailbox_id, status, urgency, received_at DESC);

DROP TRIGGER IF EXISTS trg_orit_agent_threads_updated ON public.orit_agent_threads;
CREATE TRIGGER trg_orit_agent_threads_updated
  BEFORE UPDATE ON public.orit_agent_threads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.orit_agent_messages (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id         UUID        NOT NULL REFERENCES public.orit_agent_threads(id) ON DELETE CASCADE,
  graph_message_id  TEXT,
  external_key      TEXT        NOT NULL,
  direction         TEXT        NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  body_text         TEXT        NOT NULL DEFAULT '',
  received_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  message_kind      TEXT        NOT NULL DEFAULT 'email'
                    CHECK (message_kind IN ('email', 'auto_ack', 'manual_reply')),
  UNIQUE (thread_id, external_key)
);

CREATE INDEX IF NOT EXISTS idx_orit_agent_messages_thread
  ON public.orit_agent_messages (thread_id, received_at ASC);

CREATE TABLE IF NOT EXISTS public.orit_agent_auto_ack_log (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id         UUID        NOT NULL REFERENCES public.orit_agent_threads(id) ON DELETE CASCADE,
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  graph_message_id  TEXT,
  body_preview      TEXT,
  UNIQUE (thread_id)
);

CREATE TABLE IF NOT EXISTS public.orit_agent_drafts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id       UUID        NOT NULL REFERENCES public.orit_agent_threads(id) ON DELETE CASCADE,
  suggested_text  TEXT        NOT NULL,
  final_text      TEXT,
  status          TEXT        NOT NULL DEFAULT 'suggested'
                  CHECK (status IN ('suggested', 'edited', 'sent')),
  created_by      UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.orit_agent_style_samples (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  mailbox_id        UUID        NOT NULL REFERENCES public.orit_agent_mailbox(id) ON DELETE CASCADE,
  context_category  TEXT        NOT NULL DEFAULT 'other',
  inbound_snippet   TEXT        NOT NULL DEFAULT '',
  outbound_text     TEXT        NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.orit_agent_digest_log (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  mailbox_id        UUID        NOT NULL REFERENCES public.orit_agent_mailbox(id) ON DELETE CASCADE,
  digest_date       DATE        NOT NULL,
  body_sent         TEXT        NOT NULL,
  whapi_message_id  TEXT,
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (mailbox_id, digest_date)
);

ALTER TABLE public.orit_agent_mailbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orit_agent_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orit_agent_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orit_agent_auto_ack_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orit_agent_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orit_agent_style_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orit_agent_digest_log ENABLE ROW LEVEL SECURITY;

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
    WHERE p.id = auth.uid() AND p.role IN ('super_admin', 'admin')
  );
$$;

CREATE POLICY orit_agent_mailbox_select ON public.orit_agent_mailbox
  FOR SELECT TO authenticated
  USING (
    profile_id = auth.uid()
    OR lower(owner_email) = lower((SELECT email FROM public.profiles WHERE id = auth.uid()))
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('super_admin', 'admin'))
  );

CREATE POLICY orit_agent_mailbox_update ON public.orit_agent_mailbox
  FOR UPDATE TO authenticated
  USING (public.orit_agent_user_owns_mailbox(id))
  WITH CHECK (public.orit_agent_user_owns_mailbox(id));

CREATE POLICY orit_agent_threads_all ON public.orit_agent_threads
  FOR ALL TO authenticated
  USING (public.orit_agent_user_owns_mailbox(mailbox_id))
  WITH CHECK (public.orit_agent_user_owns_mailbox(mailbox_id));

CREATE POLICY orit_agent_messages_all ON public.orit_agent_messages
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orit_agent_threads t
      WHERE t.id = thread_id AND public.orit_agent_user_owns_mailbox(t.mailbox_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.orit_agent_threads t
      WHERE t.id = thread_id AND public.orit_agent_user_owns_mailbox(t.mailbox_id)
    )
  );

CREATE POLICY orit_agent_auto_ack_select ON public.orit_agent_auto_ack_log
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orit_agent_threads t
      WHERE t.id = thread_id AND public.orit_agent_user_owns_mailbox(t.mailbox_id)
    )
  );

CREATE POLICY orit_agent_drafts_all ON public.orit_agent_drafts
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orit_agent_threads t
      WHERE t.id = thread_id AND public.orit_agent_user_owns_mailbox(t.mailbox_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.orit_agent_threads t
      WHERE t.id = thread_id AND public.orit_agent_user_owns_mailbox(t.mailbox_id)
    )
  );

CREATE POLICY orit_agent_style_select ON public.orit_agent_style_samples
  FOR SELECT TO authenticated
  USING (public.orit_agent_user_owns_mailbox(mailbox_id));

CREATE POLICY orit_agent_digest_select ON public.orit_agent_digest_log
  FOR SELECT TO authenticated
  USING (public.orit_agent_user_owns_mailbox(mailbox_id));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'orit_agent_threads'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.orit_agent_threads;
  END IF;
END $$;

INSERT INTO public.orit_agent_mailbox (owner_email, email_address, connection_status)
VALUES ('orit@dream-island.co.il', 'orit@dream-island.co.il', 'disconnected')
ON CONFLICT DO NOTHING;

DO $$
DECLARE
  v_mailbox_id UUID;
  v_thread1 UUID := gen_random_uuid();
  v_thread2 UUID := gen_random_uuid();
  v_thread3 UUID := gen_random_uuid();
BEGIN
  SELECT id INTO v_mailbox_id
  FROM public.orit_agent_mailbox
  WHERE lower(owner_email) = 'orit@dream-island.co.il'
  LIMIT 1;

  IF v_mailbox_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.orit_agent_threads (
    id, mailbox_id, external_thread_key, subject, from_email, from_name,
    received_at, snippet, status, urgency, urgency_reason, category,
    ai_summary, ai_analyzed_at, auto_ack_sent_at, sla_deadline_at, is_demo
  ) VALUES
  (
    v_thread1, v_mailbox_id, 'demo-thread-1',
    'תלונה על מזגן בחדר — לא עובד', 'guest.demo1@example.com', 'משפחת כהן',
    NOW() - INTERVAL '80 hours', 'היי, הגענו אתמול ומזגן לא מקרר בכלל...',
    'awaiting_reply', 'critical',
    'אורח מדווח על תקלה בחדר במהלך השהייה — דורש טיפול מיידי.',
    'complaint',
    'אורח מתלונן שמזגן בסוויטה לא מקרר מאז ההגעה. מבקש טכנאי דחוף.',
    NOW(), NOW() - INTERVAL '79 hours', NOW() - INTERVAL '8 hours', TRUE
  ),
  (
    v_thread2, v_mailbox_id, 'demo-thread-2',
    'שאלה על שעת כניסה מוקדמת', 'guest.demo2@example.com', 'דני לוי',
    NOW() - INTERVAL '6 hours', 'האם אפשר להיכנס לחדר לפני 15:00?',
    'awaiting_reply', 'normal',
    'שאלת מידע כללית — לא תלונה דחופה.',
    'booking',
    'אורח שואל על אפשרות צ''ק-אין מוקדם. אין תלונה על שירות.',
    NOW(), NOW() - INTERVAL '5 hours', NOW() + INTERVAL '66 hours', TRUE
  ),
  (
    v_thread3, v_mailbox_id, 'demo-thread-3',
    'בקשה לביטול הזמנה — מחר', 'guest.demo3@example.com', 'רינה אברהם',
    NOW() - INTERVAL '20 hours', 'בגלל מצב משפחתי אנחנו צריכים לבטל...',
    'awaiting_reply', 'high',
    'בקשת ביטול עם תאריך הגעה קרוב — דורש מענה מהיר.',
    'booking',
    'אורחת מבקשת לבטל הזמנה ליום מחר. מציינת סיבה משפחתית.',
    NOW(), NOW() - INTERVAL '19 hours', NOW() + INTERVAL '52 hours', TRUE
  )
  ON CONFLICT (mailbox_id, external_thread_key) DO NOTHING;

  INSERT INTO public.orit_agent_messages (thread_id, external_key, direction, body_text, received_at, message_kind)
  SELECT t.id, 'demo-msg-in-' || t.external_thread_key, 'inbound', coalesce(t.snippet, ''), t.received_at, 'email'
  FROM public.orit_agent_threads t
  WHERE t.mailbox_id = v_mailbox_id AND t.is_demo = TRUE
  ON CONFLICT (thread_id, external_key) DO NOTHING;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('orit-cs-morning-digest');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'orit-cs-morning-digest',
  '30 3 * * *',
  $$
    SELECT net.http_post(
      url     := 'https://bunohsdggxyyzruubvcd.supabase.co/functions/v1/manager-morning-digest',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);

DO $$
BEGIN
  PERFORM cron.unschedule('orit-cs-mail-sync');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'orit-cs-mail-sync',
  '*/10 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://bunohsdggxyyzruubvcd.supabase.co/functions/v1/manager-mail-sync',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);
