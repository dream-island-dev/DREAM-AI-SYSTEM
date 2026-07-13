-- Migration 194: Guest Experience Survey (Portal) + Spa warm-up automation.
--
-- Day-pass + spa cohort: post-visit structured survey (7 categories + free
-- text) delivered via the Guest Portal, with a short WhatsApp warm invite.
-- Mirrors guest_feedback's (117) RLS/realtime convention but is a separate
-- structured table (not a reinterpretation of that free-text one) — a mirror
-- row is written there only on a negative outcome, for staff attention
-- triage that already reads guest_feedback.

-- ── 1. guest_surveys ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.guest_surveys (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id              BIGINT      REFERENCES public.guests(id) ON DELETE SET NULL,
  phone                 TEXT        NOT NULL,
  visit_date            DATE        NOT NULL,
  patio                 SMALLINT    NOT NULL CHECK (patio BETWEEN 1 AND 5),
  live_kitchen           SMALLINT    NOT NULL CHECK (live_kitchen BETWEEN 1 AND 5),
  chestnut_restaurant    SMALLINT    NOT NULL CHECK (chestnut_restaurant BETWEEN 1 AND 5),
  service_team           SMALLINT    NOT NULL CHECK (service_team BETWEEN 1 AND 5),
  spa                    SMALLINT    NOT NULL CHECK (spa BETWEEN 1 AND 5),
  cleaning_maintenance   SMALLINT    NOT NULL CHECK (cleaning_maintenance BETWEEN 1 AND 5),
  overall_experience     SMALLINT    NOT NULL CHECK (overall_experience BETWEEN 1 AND 10),
  free_text             TEXT,
  avg_categories        NUMERIC(3,2) GENERATED ALWAYS AS (
                          ROUND(((patio + live_kitchen + chestnut_restaurant + service_team + spa + cleaning_maintenance)::NUMERIC / 6), 2)
                        ) STORED,
  google_cta_shown      BOOLEAN     NOT NULL DEFAULT false,
  portal_token_snapshot UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guest_id, visit_date)
);

ALTER TABLE public.guest_surveys ENABLE ROW LEVEL SECURITY;

-- Authenticated staff: full read (dashboard); writes come from the
-- service-role guest-portal-survey function, which bypasses RLS.
CREATE POLICY "guest_surveys_auth_all"
  ON public.guest_surveys FOR ALL
  USING (auth.uid() IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_guest_surveys_visit_date ON public.guest_surveys (visit_date DESC);
CREATE INDEX IF NOT EXISTS idx_guest_surveys_guest_id   ON public.guest_surveys (guest_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'guest_surveys'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.guest_surveys;
  END IF;
END $$;

-- ── 2. guests — idempotency flags for the two new automation stages ────
ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS msg_spa_warmup_sent   BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS msg_survey_invite_sent BOOLEAN    NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS survey_completed_at    TIMESTAMPTZ;

-- ── 3. automation_stages.anchor_event — widen for spa_time-relative timing ─
-- spa_warmup_daypass fires relative to the guest's own spa appointment time
-- (guests.spa_date + spa_time), not a fixed anchor date — automationSchedule.ts
-- combines the two into one instant for this anchor value only.
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
  CHECK (anchor_event IN ('arrival_date', 'departure_date', 'arrival_confirmed_at', 'checkin_time', 'spa_time'));

-- offset_hours was INTEGER (migration 065) — spa_warmup_daypass needs fractional
-- hours (75 minutes = -1.25h). Widening is backward-compatible: every existing
-- integer value (24, -1, etc.) is valid under NUMERIC too.
ALTER TABLE public.automation_stages
  ALTER COLUMN offset_hours TYPE NUMERIC;

-- ── 4. guest_feedback.source — widen for the negative-survey mirror row ──
DO $$
DECLARE
  v_conname TEXT;
BEGIN
  SELECT c.conname INTO v_conname
  FROM pg_constraint c
  JOIN pg_class t      ON t.oid = c.conrelid
  JOIN pg_attribute a  ON a.attrelid = t.oid
  WHERE t.relname = 'guest_feedback'
    AND c.contype = 'c'
    AND a.attname = 'source'
    AND a.attnum = ANY (c.conkey)
  LIMIT 1;

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.guest_feedback DROP CONSTRAINT %I', v_conname);
  END IF;
END $$;

ALTER TABLE public.guest_feedback
  ADD CONSTRAINT guest_feedback_source_check
  CHECK (source IN ('freeform_reflection', 'post_stay_button', 'severe_complaint', 'structured_survey'));

-- ── 5. automation_stages seeds ───────────────────────────────────────────
-- Stage: spa_warmup_daypass — spa_time minus 75 minutes (offset_hours=-1.25),
-- day-pass + spa cohort only. hours_after_event / anchor_event='spa_time' —
-- computeScheduledInstant resolves the actual instant from spa_date+spa_time;
-- a guest with no spa_time gets skipReason=missing_anchor_timestamp for free
-- (no silent fake time, per CLAUDE.md Graceful Fallback).
INSERT INTO automation_stages (
  stage_key, display_name, journey_phase, sequence_order, node_type,
  schedule_mode, anchor_event, day_offset, local_time, local_time_end, offset_hours,
  applies_to, meta_template_name, session_message_script_key, guest_flag_column, is_active
) VALUES (
  'spa_warmup_daypass',
  'ספא — חימום לפני הטיפול (בילוי יומי) 💆',
  'mid_stay',
  310,
  'session_message',
  'hours_after_event',
  'spa_time',
  NULL, NULL, NULL,
  -1.25,
  'non_suite',
  NULL,
  'spa_warmup_daypass',
  'msg_spa_warmup_sent',
  true
)
ON CONFLICT (stage_key) DO UPDATE SET
  display_name               = EXCLUDED.display_name,
  journey_phase               = EXCLUDED.journey_phase,
  sequence_order               = EXCLUDED.sequence_order,
  node_type                    = EXCLUDED.node_type,
  schedule_mode                = EXCLUDED.schedule_mode,
  anchor_event                 = EXCLUDED.anchor_event,
  offset_hours                 = EXCLUDED.offset_hours,
  applies_to                   = EXCLUDED.applies_to,
  session_message_script_key   = EXCLUDED.session_message_script_key,
  guest_flag_column            = EXCLUDED.guest_flag_column,
  is_active                    = EXCLUDED.is_active;

-- Stage: survey_invite_daypass — ~17:00 on the visit day, day-pass + spa
-- cohort only (extra "has spa that day" gate lives in checkEligibility,
-- since applies_to alone can't express the spa-cohort narrowing).
INSERT INTO automation_stages (
  stage_key, display_name, journey_phase, sequence_order, node_type,
  schedule_mode, anchor_event, day_offset, local_time, local_time_end, offset_hours,
  applies_to, meta_template_name, session_message_script_key, guest_flag_column, is_active
) VALUES (
  'survey_invite_daypass',
  'סקר חוויית אורח (בילוי יומי) 📊',
  'post_stay',
  410,
  'session_message',
  'day_offset_with_time',
  'arrival_date',
  0, '17:00', NULL,
  NULL,
  'non_suite',
  NULL,
  'survey_invite_daypass',
  'msg_survey_invite_sent',
  true
)
ON CONFLICT (stage_key) DO UPDATE SET
  display_name               = EXCLUDED.display_name,
  journey_phase               = EXCLUDED.journey_phase,
  sequence_order               = EXCLUDED.sequence_order,
  node_type                    = EXCLUDED.node_type,
  schedule_mode                = EXCLUDED.schedule_mode,
  anchor_event                 = EXCLUDED.anchor_event,
  day_offset                   = EXCLUDED.day_offset,
  local_time                   = EXCLUDED.local_time,
  applies_to                   = EXCLUDED.applies_to,
  session_message_script_key   = EXCLUDED.session_message_script_key,
  guest_flag_column            = EXCLUDED.guest_flag_column,
  is_active                    = EXCLUDED.is_active;

-- ── 6. bot_scripts — editable copy (BotScriptEditor / ACC) ──────────────
-- Survey link reuses the existing {{portal_url}} placeholder (already
-- resolved by whatsapp-send) with a #survey anchor baked into the literal
-- text — no new placeholder plumbing needed.
INSERT INTO bot_scripts (script_key, display_name, trigger_event, message_text, is_active)
VALUES
(
  'spa_warmup_daypass',
  'ספא — חימום לפני הטיפול (בילוי יומי)',
  'spa_warmup',
  E'{{GUEST_NAME}}, עוד קצת ומתחיל הטיפול המפנק שלכם בספא ({{SPA_TIME}}) 💆✨\n\nזה הזמן להירגע, לנשום עמוק ולהתחיל לעבור למצב פינוק. ניפגש בקרוב!',
  true
),
(
  'survey_invite_daypass',
  'סקר חוויית אורח (בילוי יומי)',
  'survey_invite',
  E'{{GUEST_NAME}}, תודה שביליתם איתנו היום! 🌴\n\nנשמח מאוד לשמוע איך היה — זה לוקח רק דקה ועוזר לנו להשתפר:\n{{portal_url}}#survey',
  true
)
ON CONFLICT (script_key) DO UPDATE
  SET display_name  = EXCLUDED.display_name,
      trigger_event = EXCLUDED.trigger_event,
      message_text  = EXCLUDED.message_text,
      is_active     = EXCLUDED.is_active;
