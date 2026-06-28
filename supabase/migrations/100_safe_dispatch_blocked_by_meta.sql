-- =============================================================================
-- 100_safe_dispatch_blocked_by_meta.sql
-- Session 59 — Safe Dispatch + Automation Diagnostic Mode (Phase 1 DB layer).
--
-- 1. Widen notification_log.status CHECK to include 'blocked_by_meta' — Meta
--    template approval / not-found errors (#132001) must NOT be logged as 'failed'
--    when internal automation logic succeeded but Meta rejected dispatch.
--    uq_notif_guest_trigger_sent (migration 088) scopes uniqueness to
--    ('sent','simulated') only — blocked_by_meta rows may accumulate across
--    retries without blocking a later successful send.
--
-- 2. Seed bot_scripts free-text bodies for hybrid pipeline stages that lacked
--    session_message_script_key wiring (pre_arrival_2d, mid_stay, checkout_fb).
--    Editable via BotScriptEditor — whatsapp-send BRANCH D reads these when
--    guests.wa_window_expires_at is open (24h session active).
--
-- 3. Wire automation_stages.session_message_script_key for those stages plus
--    morning_suite / morning_welcome (existing stage_3_morning script).
--    is_active is NOT touched — admin pause choices preserved.
-- =============================================================================

-- ── 1. notification_log.status — add blocked_by_meta ─────────────────────────
ALTER TABLE public.notification_log DROP CONSTRAINT IF EXISTS notification_log_status_check;

ALTER TABLE public.notification_log
  ADD CONSTRAINT notification_log_status_check
  CHECK (status IN ('sent', 'simulated', 'failed', 'timeout', 'blocked_by_meta'));

COMMENT ON COLUMN public.notification_log.status IS
  'sent/simulated = Meta confirmed (or simulation). failed = real dispatch error. timeout = Meta did not respond in time (outcome unknown). blocked_by_meta = internal automation triggered but Meta rejected template (e.g. #132001 pending/not found) — guest flag NOT stamped; retry allowed.';

-- ── 2. bot_scripts — hybrid free-text fallbacks for open 24h sessions ────────
INSERT INTO public.bot_scripts
  (script_key, display_name, trigger_event, is_meta_template, meta_template_name, message_text, ai_system_prompt, sort_order, is_active)
VALUES
(
  'pre_arrival_2d',
  'Stage 1 — אישור הגעה (טקסט חופשי, חלון 24ש)',
  'pre_arrival_2d',
  false,
  'dream_arrival_confirmation',
  E'שלום {{GUEST_NAME}}! 🌴\n\nמחכים לכם ב-Dream Island בעוד יומיים.\nנשמח לאישור הגעה — כתבו לנו כאן "כן, מגיעים!" ונשלים את כל הפרטים יחד.\n\nנתראה בקרוב! 🤍',
  null,
  14,
  true
),
(
  'mid_stay',
  'Stage 4 — מצב שהות (טקסט חופשי, חלון 24ש)',
  'mid_stay',
  false,
  'dream_mid_stay_check',
  E'{{GUEST_NAME}}, בוקר טוב! 🏨\n\nרצינו לוודא שהכל מושלם בשהות שלכם אצלנו.\nאיך הולך עד כה? יש משהו שצוות הקבלה יכול לסדר בשבילכם?\n\nאנחנו כאן — תכתבו לנו בכל רגע. 🤍',
  null,
  15,
  true
),
(
  'checkout_fb',
  'Stage 5 — פידבק יציאה (טקסט חופשי, חלון 24ש)',
  'checkout_fb',
  false,
  'dream_checkout_feedback',
  E'{{GUEST_NAME}}, תודה שהייתם איתנו! ⭐\n\nנשמח לשמוע איך הייתה החוויה — כל מילה עוזרת לנו להשתפר.\n\nמקווים לראות אתכם שוב ב-Dream Island. 🤍',
  null,
  16,
  true
)
ON CONFLICT (script_key) DO UPDATE
  SET
    display_name       = EXCLUDED.display_name,
    trigger_event      = EXCLUDED.trigger_event,
    is_meta_template   = EXCLUDED.is_meta_template,
    meta_template_name = EXCLUDED.meta_template_name,
    message_text       = EXCLUDED.message_text,
    sort_order         = EXCLUDED.sort_order,
    is_active          = EXCLUDED.is_active;

-- ── 3. automation_stages — wire session_message_script_key (hybrid path) ───
UPDATE public.automation_stages
SET session_message_script_key = 'pre_arrival_2d'
WHERE stage_key = 'pre_arrival_2d'
  AND (session_message_script_key IS NULL OR session_message_script_key = '');

UPDATE public.automation_stages
SET session_message_script_key = 'mid_stay'
WHERE stage_key = 'mid_stay'
  AND (session_message_script_key IS NULL OR session_message_script_key = '');

UPDATE public.automation_stages
SET session_message_script_key = 'checkout_fb'
WHERE stage_key = 'checkout_fb'
  AND (session_message_script_key IS NULL OR session_message_script_key = '');

UPDATE public.automation_stages
SET session_message_script_key = 'stage_3_morning'
WHERE stage_key IN ('morning_suite', 'morning_welcome')
  AND (session_message_script_key IS NULL OR session_message_script_key = '');

-- ── 4. Inline self-test — constraint must accept blocked_by_meta ───────────
DO $$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_constraintdef(c.oid)
    INTO v_def
  FROM pg_constraint c
  JOIN pg_class t ON c.conrelid = t.oid
  WHERE t.relname = 'notification_log'
    AND c.conname = 'notification_log_status_check';

  IF v_def IS NULL THEN
    RAISE EXCEPTION '100_self_test: notification_log_status_check constraint missing';
  END IF;

  IF v_def NOT LIKE '%blocked_by_meta%' THEN
    RAISE EXCEPTION '100_self_test: blocked_by_meta not in CHECK — got: %', v_def;
  END IF;

  -- Verify script seeds landed
  IF (SELECT COUNT(*) FROM public.bot_scripts WHERE script_key IN ('pre_arrival_2d', 'mid_stay', 'checkout_fb')) <> 3 THEN
    RAISE EXCEPTION '100_self_test: expected 3 bot_scripts rows (pre_arrival_2d, mid_stay, checkout_fb)';
  END IF;

  -- Verify automation_stages wiring
  IF NOT EXISTS (
    SELECT 1 FROM public.automation_stages
    WHERE stage_key = 'pre_arrival_2d' AND session_message_script_key = 'pre_arrival_2d'
  ) THEN
    RAISE EXCEPTION '100_self_test: pre_arrival_2d session_message_script_key not wired';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.automation_stages
    WHERE stage_key = 'mid_stay' AND session_message_script_key = 'mid_stay'
  ) THEN
    RAISE EXCEPTION '100_self_test: mid_stay session_message_script_key not wired';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.automation_stages
    WHERE stage_key = 'checkout_fb' AND session_message_script_key = 'checkout_fb'
  ) THEN
    RAISE EXCEPTION '100_self_test: checkout_fb session_message_script_key not wired';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.automation_stages
    WHERE stage_key = 'morning_suite' AND session_message_script_key = 'stage_3_morning'
  ) THEN
    RAISE EXCEPTION '100_self_test: morning_suite session_message_script_key not wired';
  END IF;
END $$;
