-- =============================================================================
-- 065_automation_stages.sql
-- Automation Control Center — Phase 1 (pure data capture, zero behavior change).
--
-- WHY:
--   "What message fires when" is currently split across three places that
--   never reference each other (PIPELINE_TEMPLATE/PIPELINE_VARS/GUEST_FLAG
--   hardcoded maps in whatsapp-send/index.ts, the bot_scripts table, and the
--   message_templates table) plus a FOURTH place for timing (hardcoded
--   day-offset + UTC-hour if/else in whatsapp-cron/index.ts). None of it is
--   admin-visible or editable — e.g. Stage 1's Meta template name
--   (dream_arrival_confirmation) exists only in source code.
--
--   This table becomes the single source of truth for per-stage TIMING and
--   CONTENT ROUTING (which Meta template / which bot_scripts row / which
--   interactive buttons). It is seeded 1:1 from today's hardcoded constants —
--   shipping this migration changes NOTHING observable. whatsapp-cron and
--   whatsapp-send are NOT wired to read from it yet (that's Phase 4, a
--   separate deliberately-staged step touching the live guest pipeline).
--
-- SCHEDULE_MODE contract (read by supabase/functions/_shared/automationSchedule.ts):
--   'day_offset_with_time' — fires at (anchor_date + day_offset days) at
--                             local_time (Israel, UTC+2 — same fixed offset
--                             whatsapp-cron already uses, no DST handling,
--                             preserved as-is rather than "fixed" here).
--                             local_time_end is an optional same-day ceiling
--                             (only night_before has one today — don't WA a
--                             guest at 1am; all other day_offset_with_time
--                             stages fire any time from local_time to
--                             midnight, exactly as today).
--   'hours_after_event'   — fires at (anchor_timestamp + offset_hours hours).
--   'event_immediate'     — fires synchronously as a direct reply; not part
--                             of the cron scan at all (stage_2_arrival).
--
-- room_ready is intentionally NOT seeded here — it is event-driven from the
-- RoomBoard/AICopilot UI toggle, not a timeline stage (see whatsapp-cron's
-- own header comment: "room_ready is event-driven from the UI toggle").
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.automation_stages (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_key                   TEXT        UNIQUE NOT NULL,
  display_name                TEXT        NOT NULL,
  journey_phase                TEXT        NOT NULL
                                CHECK (journey_phase IN ('pre_arrival', 'arrival_day', 'mid_stay', 'post_stay')),
  sequence_order               INTEGER     NOT NULL DEFAULT 0,
  node_type                   TEXT        NOT NULL
                                CHECK (node_type IN ('meta_template', 'session_message', 'hybrid')),
  schedule_mode                TEXT        NOT NULL
                                CHECK (schedule_mode IN ('day_offset_with_time', 'hours_after_event', 'event_immediate')),
  anchor_event                 TEXT        NOT NULL
                                CHECK (anchor_event IN ('arrival_date', 'departure_date', 'arrival_confirmed_at', 'checkin_time')),
  day_offset                   INTEGER,                 -- day_offset_with_time mode
  local_time                   TIME,                     -- day_offset_with_time mode — floor
  local_time_end                TIME,                    -- day_offset_with_time mode — optional same-day ceiling
  offset_hours                 INTEGER,                  -- hours_after_event mode
  applies_to                   TEXT        NOT NULL DEFAULT 'all'
                                -- only 'suite' vs everything-else is meaningful to the current
                                -- pipeline today (whatsapp-cron's morning_welcome guard is
                                -- literally `room_type !== "suite"` — covers standard AND
                                -- day_guest in one branch). Modeling a finer split here would
                                -- silently change which guests morning_welcome reaches.
                                CHECK (applies_to IN ('all', 'suite', 'non_suite')),
  meta_template_name           TEXT,                      -- approved Meta template (existing PIPELINE_TEMPLATE value)
  session_message_script_key   TEXT,                      -- reuses bot_scripts.script_key — no content duplication
  interactive_buttons          JSONB       NOT NULL DEFAULT '[]'::jsonb,
  guest_flag_column            TEXT,                      -- existing guests.msg_*_sent column name, kept for compatibility
  is_active                    BOOLEAN     NOT NULL DEFAULT true,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_automation_stages_updated ON public.automation_stages;
CREATE TRIGGER trg_automation_stages_updated
  BEFORE UPDATE ON public.automation_stages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_automation_stages_sort ON public.automation_stages (sequence_order);

-- ── RLS — same convention as bot_scripts (migration 032): authenticated
--    read/write, admin-only enforcement happens in the frontend via guardPage.
ALTER TABLE public.automation_stages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated users can read automation_stages"  ON public.automation_stages;
DROP POLICY IF EXISTS "authenticated users can write automation_stages" ON public.automation_stages;

CREATE POLICY "authenticated users can read automation_stages"
  ON public.automation_stages FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated users can write automation_stages"
  ON public.automation_stages FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ── Seed: 1:1 capture of current hardcoded behavior ──────────────────────────
-- ON CONFLICT on stage_key → safe to re-run. meta_template_name/session_message_
-- script_key/interactive_buttons are intentionally re-asserted on conflict so a
-- re-run restores the documented baseline; is_active is NOT overwritten, same
-- pattern as bot_scripts, so an admin's pause choice survives a re-run.

INSERT INTO public.automation_stages
  (stage_key, display_name, journey_phase, sequence_order, node_type, schedule_mode,
   anchor_event, day_offset, local_time, local_time_end, offset_hours, applies_to,
   meta_template_name, session_message_script_key, guest_flag_column)
VALUES

-- ── Stage 1 — ROOT TRIGGER (req #5: previously invisible outside source code) ─
(
  'pre_arrival_2d', 'Stage 1 — אישור הגעה 🌴', 'pre_arrival', 100, 'hybrid', 'day_offset_with_time',
  'arrival_date', -2, NULL, NULL, NULL, 'all',
  'dream_arrival_confirmation', NULL, 'msg_pre_arrival_2d_sent'
),

-- ── Stage 1.5 — night-before reminder (only stage with a same-day ceiling —
--    whatsapp-cron's existing hourUTC<=21 guard, preserved here) ──────────────
(
  'night_before', 'Stage 1.5 — תזכורת ערב לפני 📅', 'pre_arrival', 150, 'hybrid', 'day_offset_with_time',
  'arrival_date', -1, '19:00', '23:00', NULL, 'all',
  'dream_checkin_reminder_v2', NULL, 'msg_pre_arrival_sent'
),

-- ── Stage 2 — event-driven reply to "כן, מגיעים!" (always inside an open
--    24h window by construction — no Meta-template fallback needed) ─────────
(
  'stage_2_arrival', 'Stage 2 — אישור הגעה + ספא 🥰', 'arrival_day', 200, 'session_message', 'event_immediate',
  'arrival_confirmed_at', NULL, NULL, NULL, 0, 'all',
  NULL, 'stage_2_arrival', NULL
),

(
  'morning_suite', 'Stage 3 — בוקר הגעה (סוויטות) ☀️', 'arrival_day', 250, 'hybrid', 'day_offset_with_time',
  'arrival_date', 0, '06:00', NULL, NULL, 'suite',
  'dream_welcome_morning', NULL, 'msg_morning_suite_sent'
),

(
  'morning_welcome', 'Stage 3 — בוקר הגעה (רגיל) ☀️', 'arrival_day', 260, 'hybrid', 'day_offset_with_time',
  'arrival_date', 0, '08:00', NULL, NULL, 'non_suite',
  'dream_welcome_morning', NULL, 'msg_morning_welcome_sent'
),

(
  'butler_1h', 'Stage 3.5 — העברת סוכן (שעה אחרי צ׳ק-אין) 🤝', 'arrival_day', 280, 'hybrid', 'hours_after_event',
  'checkin_time', NULL, NULL, NULL, 1, 'suite',
  'dream_handover_agent_v2', NULL, 'msg_post_checkin_sent'
),

(
  'mid_stay', 'Stage 4 — מצב שהות 🏨', 'mid_stay', 300, 'hybrid', 'day_offset_with_time',
  'arrival_date', 1, '10:00', NULL, NULL, 'all',
  'dream_mid_stay_check', NULL, 'msg_mid_stay_sent'
),

(
  'checkout_fb', 'Stage 5 — פידבק יציאה ⭐', 'post_stay', 400, 'hybrid', 'day_offset_with_time',
  'departure_date', 1, '09:00', NULL, NULL, 'all',
  'dream_checkout_feedback', NULL, 'msg_checkout_fb_sent'
)

ON CONFLICT (stage_key) DO UPDATE
  SET
    display_name              = EXCLUDED.display_name,
    journey_phase              = EXCLUDED.journey_phase,
    sequence_order              = EXCLUDED.sequence_order,
    node_type                  = EXCLUDED.node_type,
    schedule_mode               = EXCLUDED.schedule_mode,
    anchor_event                = EXCLUDED.anchor_event,
    day_offset                  = EXCLUDED.day_offset,
    local_time                  = EXCLUDED.local_time,
    local_time_end               = EXCLUDED.local_time_end,
    offset_hours                = EXCLUDED.offset_hours,
    applies_to                  = EXCLUDED.applies_to,
    meta_template_name          = EXCLUDED.meta_template_name,
    session_message_script_key  = EXCLUDED.session_message_script_key,
    guest_flag_column           = EXCLUDED.guest_flag_column
    -- is_active intentionally NOT overwritten on conflict — preserves an
    -- admin's pause choice, same convention as bot_scripts (migration 032).
;

COMMENT ON TABLE  public.automation_stages IS 'Single source of truth for WhatsApp pipeline stage timing + content routing — edited via the Automation Control Center UI. Seeded 1:1 from whatsapp-send/whatsapp-cron hardcoded constants; not yet read by either (see Phase 4).';
COMMENT ON COLUMN public.automation_stages.local_time_end IS 'Optional same-day ceiling (Israel local time) — only night_before uses this today, preserving whatsapp-cron''s existing hourUTC<=21 guest-experience guard against very-late-night sends.';
COMMENT ON COLUMN public.automation_stages.session_message_script_key IS 'References bot_scripts.script_key by value (no FK constraint — bot_scripts rows are seeded/managed independently). NULL means this stage has no rich session-message option yet — falls back to meta_template_name whenever dispatched.';
