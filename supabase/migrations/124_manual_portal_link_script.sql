-- =============================================================================
-- 124_manual_portal_link_script.sql
-- Manual Portal Link Dispatch — standalone on-demand bot_scripts row.
--
-- Gives staff a reusable script to fire the Guest Portal magic-link at any
-- time from the WhatsApp Inbox, independent of the automated lifecycle
-- stages (automation_stages) — no arrival_date/status gating, no cron.
--
-- {{GUEST_NAME}} and {{portal_url}} are substituted server-side by
-- whatsapp-send's manual_script dispatch (see that Edge Function for the
-- resolver — same graceful-fallback contract as every other placeholder in
-- this codebase: strip the containing sentence if portal_token is somehow
-- missing rather than send a dead/blank link).
--
-- trigger_event = 'manual' (new value — this row is never picked up by any
-- automation_stages/cron scan, which all key off arrival_confirmed/morning_of/
-- ongoing/complaint/upsell/room_ready/etc.; it is only ever read by script_key).
-- =============================================================================

INSERT INTO public.bot_scripts
  (script_key, display_name, trigger_event, is_meta_template,
   meta_template_name, message_text, ai_system_prompt, sort_order, is_active)
VALUES
(
  'manual_portal_link',
  'שליחה ידנית של קישור לפורטל האורחים',
  'manual',
  false,
  null,
  E'היי {{GUEST_NAME}}, הנה הקישור הישיר לפורטל האורחים שלך כדי שתוכל להתעדכן בכל הפרטים: {{portal_url}} נשמח לראותכם! ✨',
  null,
  200,
  true
)
ON CONFLICT (script_key) DO UPDATE
  SET
    display_name       = EXCLUDED.display_name,
    trigger_event       = EXCLUDED.trigger_event,
    is_meta_template   = EXCLUDED.is_meta_template,
    meta_template_name = EXCLUDED.meta_template_name,
    message_text       = EXCLUDED.message_text,
    sort_order         = EXCLUDED.sort_order,
    is_active          = EXCLUDED.is_active;

-- Inline self-test
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.bot_scripts
    WHERE script_key = 'manual_portal_link' AND is_active = true
  ) THEN
    RAISE EXCEPTION '124_self_test: manual_portal_link bot_script missing or inactive';
  END IF;

  IF (SELECT message_text FROM public.bot_scripts WHERE script_key = 'manual_portal_link')
       NOT LIKE '%{{GUEST_NAME}}%' THEN
    RAISE EXCEPTION '124_self_test: manual_portal_link message_text missing {{GUEST_NAME}} placeholder';
  END IF;

  IF (SELECT message_text FROM public.bot_scripts WHERE script_key = 'manual_portal_link')
       NOT LIKE '%{{portal_url}}%' THEN
    RAISE EXCEPTION '124_self_test: manual_portal_link message_text missing {{portal_url}} placeholder';
  END IF;
END $$;
