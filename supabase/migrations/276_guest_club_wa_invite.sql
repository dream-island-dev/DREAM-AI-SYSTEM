-- 276: Guest Club WA invite (after positive review) + suite departure-day survey fallback.

ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS msg_club_invite_sent BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.guests.msg_club_invite_sent IS
  'True after guest_club_invite WA was sent (post positive survey / מושלם button).';

CREATE TABLE IF NOT EXISTS public.guest_club_invite_queue (
  id          BIGSERIAL PRIMARY KEY,
  guest_id    BIGINT NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
  source      TEXT NOT NULL DEFAULT 'positive_feedback_wa',
  send_after  TIMESTAMPTZ NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at     TIMESTAMPTZ,
  error_text  TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS guest_club_invite_queue_one_pending
  ON public.guest_club_invite_queue (guest_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS guest_club_invite_queue_due
  ON public.guest_club_invite_queue (send_after)
  WHERE status = 'pending';

ALTER TABLE public.guest_club_invite_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "guest_club_invite_queue_auth_all"
  ON public.guest_club_invite_queue FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

INSERT INTO public.bot_config (config_key, config_value, category, label)
VALUES (
  'guest_club_wa_settings',
  '{"wa_invite_enabled":true,"wa_invite_delay_minutes":3,"portal_offer_enabled":true,"departure_fallback_enabled":true,"departure_fallback_time":"19:00"}',
  'automation',
  'מועדון לקוחות — הצעה ב-WA + fallback סקר עזיבה (JSON)'
)
ON CONFLICT (config_key) DO NOTHING;

INSERT INTO public.bot_scripts (script_key, display_name, trigger_event, message_text, is_active)
VALUES (
  'guest_club_invite',
  'הצטרפות למועדון לקוחות (אחרי ביקורת חיובית)',
  'guest_club_invite',
  E'{{GUEST_NAME}}, תודה על המשוב! 🌴\n\nרוצים הצעות בלעדיות, הטבות לימי הולדת ועדכונים מיוחדים?\nהצטרפו למועדון הלקוחות שלנו:\n{{portal_url}}#club',
  true
)
ON CONFLICT (script_key) DO UPDATE
  SET display_name  = EXCLUDED.display_name,
      trigger_event = EXCLUDED.trigger_event,
      message_text  = COALESCE(NULLIF(TRIM(bot_scripts.message_text), ''), EXCLUDED.message_text),
      is_active     = EXCLUDED.is_active;

-- anchor_event is required (NOT NULL + CHECK) even for event_immediate stages — it's
-- purely documentary there (automationSchedule.ts only reads it for hours_after_event /
-- day_offset_with_time, same as stage_2_arrival/stage_2_pay's 'arrival_confirmed_at'),
-- but no existing value describes "fires after a positive feedback survey" — widen the
-- CHECK the same way migration 194 added 'spa_time' rather than reuse a misleading label.
DO $$
DECLARE
  v_conname TEXT;
BEGIN
  SELECT c.conname INTO v_conname
  FROM pg_constraint c
  JOIN pg_class t      ON t.oid = c.conrelid
  JOIN pg_attribute a  ON a.attrelid = t.oid
  WHERE t.relname = 'automation_stages'
    AND c.contype = 'c'
    AND a.attname = 'anchor_event'
    AND a.attnum = ANY (c.conkey)
  LIMIT 1;

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.automation_stages DROP CONSTRAINT %I', v_conname);
  END IF;
END $$;

ALTER TABLE public.automation_stages
  ADD CONSTRAINT automation_stages_anchor_event_check
  CHECK (anchor_event IN (
    'arrival_date', 'departure_date', 'arrival_confirmed_at', 'checkin_time', 'spa_time',
    'guest_club_invite'
  ));

INSERT INTO public.automation_stages (
  stage_key, display_name, journey_phase, sequence_order, node_type,
  schedule_mode, anchor_event, day_offset, local_time, local_time_end, offset_hours,
  applies_to, meta_template_name, session_message_script_key, guest_flag_column, is_active
) VALUES (
  'guest_club_invite',
  'הצעת מועדון לקוחות ב-WA 🌴',
  'post_stay',
  420,
  'session_message',
  'event_immediate',
  'guest_club_invite',
  NULL, NULL, NULL,
  NULL,
  'all',
  NULL,
  'guest_club_invite',
  'msg_club_invite_sent',
  true
)
ON CONFLICT (stage_key) DO UPDATE SET
  display_name               = EXCLUDED.display_name,
  journey_phase              = EXCLUDED.journey_phase,
  sequence_order             = EXCLUDED.sequence_order,
  node_type                  = EXCLUDED.node_type,
  session_message_script_key = EXCLUDED.session_message_script_key,
  guest_flag_column          = EXCLUDED.guest_flag_column;
