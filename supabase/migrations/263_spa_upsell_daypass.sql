-- 263_spa_upsell_daypass.sql
-- Spa treatment upsell offer for day-pass guests who arrived without a spa
-- booking — 45-minute massage at 300 ILS (full price 370 ILS).
--
-- MANUAL DISPATCH ONLY (owner decision, 2026-07-20): day-pass automated guest
-- outbound is permanently Meta-only (migration 205, ban prevention —
-- shouldRouteGuestOutboundViaWhapiSuites() unconditionally returns false for
-- isEffectiveDayPassGuest). This offer is a NEW, staff-initiated, per-batch
-- send from DataSyncPage's "Send Offer Now" action, using the same
-- force_channel="whapi_session" escape hatch AutomationControlCenter's manual
-- dispatch already uses — never through whatsapp-cron. is_active=false keeps
-- it out of the automatic scan entirely (isStageEffectivelyActive reduces to
-- stage.is_active for day-pass guests), while still letting whatsapp-send's
-- BRANCH D resolve session_message_script_key for the manual force dispatch.
--
-- Text is intentionally editable in bot_scripts (BotScriptEditor) — no Meta
-- template needed since this never goes through the template path.

ALTER TABLE public.guests ADD COLUMN IF NOT EXISTS msg_spa_upsell_sent BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN public.guests.msg_spa_upsell_sent IS 'Spa treatment upsell offer sent to a day-pass guest with no spa booking today (manual dispatch only, DataSyncPage "Send Offer Now") — prevents duplicate sends across repeated Doc1 imports.';

INSERT INTO public.bot_scripts (script_key, display_name, trigger_event, message_text, is_active)
VALUES (
  'spa_upsell_daypass',
  'הצעת טיפול ספא — בילוי יומי (שיגור ידני) 💆',
  'upsell',
  E'היי {{GUEST_NAME}} 💆\nשמנו לב שעדיין לא הזמנתם טיפול ספא להיום.\nמוסיפים עיסוי מרגיע של 45 דק׳ להזמנה שלכם ב-300 ₪ בלבד (מחיר מלא 370 ₪).\nרוצים להוסיף? השיבו לנו כאן ונשמור לכם מקום 🙏',
  true
)
ON CONFLICT (script_key) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      message_text = EXCLUDED.message_text,
      is_active    = EXCLUDED.is_active;

INSERT INTO public.automation_stages (
  stage_key, display_name, journey_phase, sequence_order, node_type, schedule_mode,
  anchor_event, day_offset, local_time, local_time_end, applies_to,
  meta_template_name, session_message_script_key, guest_flag_column, is_active
)
VALUES (
  'spa_upsell_daypass', 'הצעת ספא — בילוי יומי (ידני בלבד) 💆', 'arrival_day', 270, 'session_message',
  'day_offset_with_time', 'arrival_date', 0, '10:00', '18:00', 'non_suite',
  NULL, 'spa_upsell_daypass', 'msg_spa_upsell_sent', false
)
ON CONFLICT (stage_key) DO UPDATE
  SET display_name                = EXCLUDED.display_name,
      session_message_script_key  = EXCLUDED.session_message_script_key,
      guest_flag_column            = EXCLUDED.guest_flag_column
      -- is_active intentionally NOT overwritten — same convention as migration 065/094.
;

COMMENT ON TABLE public.automation_stages IS 'Single source of truth for WhatsApp pipeline stage timing + content routing — edited via the Automation Control Center UI. spa_upsell_daypass is manual-dispatch-only (is_active=false) by design — see migration 263.';
