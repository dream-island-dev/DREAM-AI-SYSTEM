-- =============================================================================
-- 067_stage_2_pay.sql
-- "Stage 2 Pay" — dynamic payment branch for the arrival-confirmation reply.
--
-- WHY:
--   Today, every guest who confirms arrival ("כן, מגיעים!") gets the same
--   Stage 2 reply (spa time + workshop link), regardless of whether they have
--   an outstanding balance. Payment collection is a fully separate manual
--   step (GuestsPage's "💳 תשלום" button → whatsapp-send's payment_and_workshops
--   trigger, a Meta-approved template). This migration adds a NEW, admin-
--   toggleable automation_stages row so whatsapp-webhook can automatically
--   send the payment/workshop message INSTEAD OF the standard spa message,
--   for guests who already have both payment_amount and payment_link_url set
--   on their `guests` row — entirely as a free-text session message (the 24h
--   window is always open here by construction, since the guest just messaged
--   us). Guests with no pending balance are completely unaffected — see the
--   paired whatsapp-webhook/index.ts code change for the actual branching.
--
--   The existing manual "💳 תשלום" button / payment_and_workshops trigger in
--   whatsapp-send is untouched and remains available to staff (resends, or
--   guests outside this auto-flow).
--
-- Also reorders "Stage 1.5" (night_before) later in the Timeline tab's
-- display order — its actual send time (T-1, 19:00–23:00 Israel) is computed
-- independently of list order by resolveStageSchedule(), so this is a pure
-- display-order fix, not a timing change. No other column on that row changes.
-- =============================================================================

-- ── New automation_stages row: Stage 2 Pay ───────────────────────────────────
-- event_immediate + session_message, exactly like stage_2_arrival — fires
-- synchronously from whatsapp-webhook, never polled by whatsapp-cron (which
-- already excludes schedule_mode='event_immediate' from its scan).
INSERT INTO public.automation_stages
  (stage_key, display_name, journey_phase, sequence_order, node_type, schedule_mode,
   anchor_event, day_offset, local_time, local_time_end, offset_hours, applies_to,
   meta_template_name, session_message_script_key, guest_flag_column)
VALUES
(
  'stage_2_pay', 'Stage 2 Pay — תשלום + סדנאות 💳', 'arrival_day', 210, 'session_message', 'event_immediate',
  'arrival_confirmed_at', NULL, NULL, NULL, NULL, 'all',
  'dream_payment_and_workshops', 'stage_2_payment_reply', NULL
)
ON CONFLICT (stage_key) DO UPDATE
  SET
    display_name                = EXCLUDED.display_name,
    journey_phase                = EXCLUDED.journey_phase,
    sequence_order                = EXCLUDED.sequence_order,
    node_type                    = EXCLUDED.node_type,
    schedule_mode                 = EXCLUDED.schedule_mode,
    anchor_event                  = EXCLUDED.anchor_event,
    day_offset                    = EXCLUDED.day_offset,
    local_time                    = EXCLUDED.local_time,
    local_time_end                 = EXCLUDED.local_time_end,
    offset_hours                  = EXCLUDED.offset_hours,
    applies_to                    = EXCLUDED.applies_to,
    meta_template_name            = EXCLUDED.meta_template_name,
    session_message_script_key    = EXCLUDED.session_message_script_key,
    guest_flag_column             = EXCLUDED.guest_flag_column
    -- is_active intentionally NOT overwritten on conflict — same convention
    -- as migration 065, preserves an admin's pause choice across re-runs.
;

-- ── New bot_scripts row: editable text for Stage 2 Pay ──────────────────────
-- Placeholders resolved by a NEW, separate function (resolvePaymentPlaceholders)
-- in whatsapp-webhook/index.ts — does not touch resolvePlaceholders() used by
-- the existing spa-time Stage 2 reply. Draft wording — meant to be refined via
-- the Automation Control Center's session-message editor, same as every other
-- stage's text.
INSERT INTO public.bot_scripts
  (script_key, display_name, trigger_event, is_meta_template, meta_template_name, message_text, ai_system_prompt, sort_order)
VALUES
(
  'stage_2_payment_reply',
  'Stage 2 Pay — תשלום + סדנאות 💳',
  'arrival_confirmed',
  false,
  null,
  E'מגיעים! \U0001F389 כבר מתרגשים מאד מהגעתכם, {{GUEST_NAME}}!\n\nהצוות שלנו ב-Dream Island מכין את הכל ומחכה לכם עם חיוך גדול \U0001F334\n\nלפני ההגעה, נשארה יתרת תשלום בסך {{PAYMENT_AMOUNT}} ₪ להסדרה — ניתן לסגור את זה בקליק אחד כאן:\n\U0001F449 {{PAYMENT_LINK}}\n\n\U0001F3AF *לסדנאות שלנו — הרשמו מראש:*\n\U0001F449 {{WORKSHOP_URL}}\n\nיש לכם שאלות לפני ההגעה? אני כאן לכל שאלה \U0001F60A',
  null,
  14
)
ON CONFLICT (script_key) DO UPDATE
  SET
    display_name       = EXCLUDED.display_name,
    message_text        = EXCLUDED.message_text,
    ai_system_prompt     = EXCLUDED.ai_system_prompt,
    trigger_event        = EXCLUDED.trigger_event,
    meta_template_name   = EXCLUDED.meta_template_name,
    sort_order           = EXCLUDED.sort_order
    -- is_active intentionally NOT overwritten on conflict — same convention
    -- as migrations 032/048.
;

-- ── Chronology fix: move "Stage 1.5" (night_before) later in Timeline order ──
-- Display-order only — day_offset/local_time/local_time_end/anchor_event/
-- node_type/schedule_mode/meta_template_name/guest_flag_column/is_active are
-- all untouched, so live send behavior is unchanged.
UPDATE public.automation_stages
SET sequence_order = 220
WHERE stage_key = 'night_before';

COMMENT ON COLUMN public.automation_stages.session_message_script_key IS 'References bot_scripts.script_key by value (no FK constraint — bot_scripts rows are seeded/managed independently). NULL means this stage has no rich session-message option yet — falls back to meta_template_name whenever dispatched. stage_2_arrival and stage_2_pay are event_immediate exceptions dispatched directly by whatsapp-webhook, not through this fallback.';
